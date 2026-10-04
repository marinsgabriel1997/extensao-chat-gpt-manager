import type {
  Conversation,
  ConversationContext,
  ConversationId,
  ConversationSearchHit,
  DeleteBatchResult,
  DeleteItemResult,
  MoveBatchResult,
  MoveItemResult,
  OperationFailureReason,
  Project,
  ProjectId,
} from "./domain.js";
import { logger } from "./logger.js";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const MOVE_CONCURRENCY = 1;
const DELETE_CONCURRENCY = 1;
const MIN_REQUEST_INTERVAL_MS = 500;
const LIST_PAGE_SIZE = 100;

// Política de resiliência: apenas falhas transitórias são retentadas. Status
// determinísticos (400, 403, 404) repetiriam o mesmo resultado, só atrasando o lote.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_JITTER_RATIO = 0.25;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RATE_LIMIT_WAIT_MS = 120_000;

type JsonObject = Record<string, unknown>;

interface IntegrationErrorOptions {
  attempt?: number;
  retryable?: boolean;
}

export class IntegrationError extends Error {
  readonly attempt: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number | null = null,
    options: IntegrationErrorOptions = {},
  ) {
    super(message);
    this.name = "IntegrationError";
    this.attempt = options.attempt ?? 1;
    this.retryable = options.retryable ?? (status !== null && RETRYABLE_STATUSES.has(status));
  }
}

// `phase: "waiting"` indica pausa por rate limit; `total: 0` indica total ainda
// desconhecido (paginação em andamento).
export interface OperationProgress {
  phase: "working" | "waiting";
  done: number;
  total: number;
  title: string | null;
}

export type ProgressListener = (progress: OperationProgress) => void;

// Tempo e aleatoriedade são injetáveis para que os testes de backoff sejam
// determinísticos e não dependam de tempo real.
export interface ClientDependencies {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const defaultDependencies: ClientDependencies = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
  random: () => Math.random(),
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Datas chegam em formatos diferentes conforme o endpoint (docs/chatgpt-integration.md):
// texto ISO 8601 na listagem geral, epoch numérico em segundos no detalhe e na
// pesquisa. O domínio recebe sempre ISO 8601.
function timestampValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }

  const text = stringValue(value);
  if (text === null) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return new Date(Number(text) * 1000).toISOString();
  }

  return Number.isFinite(Date.parse(text)) ? text : null;
}

function projectIdFromPayload(payload: JsonObject): ProjectId | null {
  const gizmoId = stringValue(payload.gizmo_id);
  if (gizmoId?.startsWith("g-p-")) {
    return gizmoId;
  }

  const templateId = stringValue(payload.conversation_template_id);
  return templateId?.startsWith("g-p-") ? templateId : null;
}

export function conversationFromPayload(payload: unknown): Conversation | null {
  if (!isObject(payload)) {
    return null;
  }

  const id = stringValue(payload.conversation_id) ?? stringValue(payload.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    title: stringValue(payload.title) ?? "Conversa sem título",
    preview: firstVisibleText(activePath(payload), "user"),
    projectId: projectIdFromPayload(payload),
    createdAt: timestampValue(payload.create_time),
    updatedAt: timestampValue(payload.update_time),
  };
}

export function searchHitFromPayload(payload: unknown): ConversationSearchHit | null {
  if (!isObject(payload)) {
    return null;
  }

  const id = stringValue(payload.conversation_id) ?? stringValue(payload.id);
  if (id === null) {
    return null;
  }

  const searchPayload = isObject(payload.payload) ? payload.payload : {};
  return {
    id,
    title: stringValue(payload.title) ?? "Conversa sem título",
    snippet: stringValue(searchPayload.snippet) ?? "",
    updatedAt: timestampValue(payload.update_time),
  };
}

export function conversationContextFromPayload(
  conversationId: ConversationId,
  payload: unknown,
): ConversationContext {
  if (!isObject(payload)) {
    throw new IntegrationError("O detalhe da conversa retornou um formato inválido.");
  }

  const path = activePath(payload);
  return {
    conversationId,
    firstUserMessage: firstVisibleText(path, "user"),
    lastAssistantMessage: firstVisibleText([...path].reverse(), "assistant"),
  };
}

// Caminho ativo da conversa, da raiz até `current_node`: `mapping` é uma árvore
// ligada por `parent`, e ramos abandonados (edições, regenerações) ficam fora.
function activePath(payload: JsonObject): JsonObject[] {
  if (!isObject(payload.mapping)) {
    return [];
  }

  const nodes = payload.mapping;
  const path: JsonObject[] = [];
  const visited = new Set<string>();
  let nodeId = stringValue(payload.current_node);

  while (nodeId !== null && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = nodes[nodeId];
    if (!isObject(node)) {
      break;
    }
    path.push(node);
    nodeId = stringValue(node.parent);
  }

  return path.reverse();
}

function firstVisibleText(
  nodes: readonly JsonObject[],
  role: "user" | "assistant",
): string {
  for (const node of nodes) {
    const text = visibleTextFromNode(node, role);
    if (text !== null) {
      return text;
    }
  }

  return "";
}

// Só `content_type = "text"` é texto visível: raciocínio (`thoughts`,
// `reasoning_recap`) e contexto editável do modelo têm tipos próprios.
function visibleTextFromNode(node: JsonObject, role: "user" | "assistant"): string | null {
  if (!isObject(node.message)) {
    return null;
  }

  const message = node.message;
  const author = isObject(message.author) ? message.author : {};
  const content = isObject(message.content) ? message.content : {};
  const metadata = isObject(message.metadata) ? message.metadata : {};

  if (
    author.role !== role ||
    content.content_type !== "text" ||
    metadata.is_visually_hidden_from_conversation === true
  ) {
    return null;
  }

  // Respostas do assistente endereçadas a ferramentas não são texto para o usuário.
  if (role === "assistant" && message.recipient !== undefined && message.recipient !== "all") {
    return null;
  }

  const text = arrayValue(content.parts)
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .trim();

  return text.length > 0 ? text : null;
}

function projectFromSidebarItem(payload: unknown): Project | null {
  if (!isObject(payload) || !isObject(payload.gizmo) || !isObject(payload.gizmo.gizmo)) {
    return null;
  }

  const rawProject = payload.gizmo.gizmo;
  const id = stringValue(rawProject.id);
  const display = isObject(rawProject.display) ? rawProject.display : {};
  const name = stringValue(display.name);

  return id !== null && name !== null ? { id, name } : null;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await operation(item, index);
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export class ChatGptClient {
  private accessToken: string | null = null;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private rateLimitedUntil = 0;
  private listingPromise: Promise<Conversation[]> | null = null;

  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  private progressListener: ProgressListener | null = null;
  private progressDone = 0;
  private progressTotal = 0;

  constructor(dependencies: Partial<ClientDependencies> = {}) {
    this.now = dependencies.now ?? defaultDependencies.now;
    this.sleep = dependencies.sleep ?? defaultDependencies.sleep;
    this.random = dependencies.random ?? defaultDependencies.random;
  }

  // Pesquisa por conteúdo. Não resolve o vínculo com Projeto: a pesquisa não o
  // informa, e o painel cruza os resultados com a listagem completa.
  async searchConversations(query: string): Promise<ConversationSearchHit[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new Error("Digite um texto para pesquisar.");
    }

    logger.info("search", "started", { query: normalizedQuery });
    const hits = new Map<ConversationId, ConversationSearchHit>();
    let cursor: string | null = null;
    let page = 0;
    const visitedCursors = new Set<string>();

    do {
      const url = new URL("/backend-api/conversations/search", CHATGPT_ORIGIN);
      url.searchParams.set("query", normalizedQuery);
      if (cursor !== null) {
        url.searchParams.set("cursor", cursor);
      }

      const payload = await this.fetchJson(url, { method: "GET" });
      if (!isObject(payload)) {
        throw new IntegrationError("A pesquisa retornou um formato inválido.");
      }

      const pageItems = arrayValue(payload.items)
        .map(searchHitFromPayload)
        .filter((item): item is ConversationSearchHit => item !== null);
      for (const item of pageItems) {
        if (!hits.has(item.id)) {
          hits.set(item.id, item);
        }
      }
      page += 1;
      logger.debug("search", "page_loaded", { page, items: pageItems.length });

      const nextCursor = stringValue(payload.cursor);
      if (nextCursor !== null && visitedCursors.has(nextCursor)) {
        logger.warn("search", "repeated_cursor", { page });
        cursor = null;
      } else {
        if (nextCursor !== null) {
          visitedCursors.add(nextCursor);
        }
        cursor = nextCursor;
      }
    } while (cursor !== null);

    logger.info("search", "completed", { pages: page, found: hits.size });
    return [...hits.values()];
  }

  // Somente os nomes dos Projetos. As conversas de cada Projeto vêm da listagem
  // completa, que informa o vínculo por item.
  async listProjects(): Promise<Project[]> {
    logger.info("projects", "list_started");
    const projects: Project[] = [];
    let cursor: string | null = null;
    let page = 0;
    const visitedCursors = new Set<string>();

    do {
      const url = new URL("/backend-api/gizmos/snorlax/sidebar", CHATGPT_ORIGIN);
      url.searchParams.set("owned_only", "true");
      url.searchParams.set("conversations_per_gizmo", "5");
      url.searchParams.set("limit", "20");
      if (cursor !== null) {
        url.searchParams.set("cursor", cursor);
      }

      const payload = await this.fetchJson(url, { method: "GET" });
      if (!isObject(payload)) {
        throw new IntegrationError("A lista de Projetos retornou um formato inválido.");
      }

      const pageItems = arrayValue(payload.items)
        .map(projectFromSidebarItem)
        .filter((item): item is Project => item !== null);
      projects.push(...pageItems);
      page += 1;
      logger.debug("projects", "page_loaded", { page, items: pageItems.length });

      const nextCursor = stringValue(payload.cursor);
      if (nextCursor !== null && visitedCursors.has(nextCursor)) {
        logger.warn("projects", "repeated_cursor", { page });
        cursor = null;
      } else {
        if (nextCursor !== null) {
          visitedCursors.add(nextCursor);
        }
        cursor = nextCursor;
      }
    } while (cursor !== null);

    const unique = [...new Map(projects.map((project) => [project.id, project])).values()];
    unique.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    logger.info("projects", "list_completed", { pages: page, projects: unique.length });
    return unique;
  }

  async getConversation(conversationId: ConversationId): Promise<Conversation> {
    const url = new URL(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      CHATGPT_ORIGIN,
    );
    const payload = await this.fetchJson(url, { method: "GET" });
    const conversation = conversationFromPayload(payload);

    if (conversation === null) {
      throw new IntegrationError("O detalhe da conversa retornou um formato inválido.");
    }

    const normalizedConversation = conversation.id === conversationId
      ? conversation
      : { ...conversation, id: conversationId };
    return { ...normalizedConversation };
  }

  async getConversationContext(conversationId: ConversationId): Promise<ConversationContext> {
    const url = new URL(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      CHATGPT_ORIGIN,
    );
    const payload = await this.fetchJson(url, { method: "GET" });
    const context = conversationContextFromPayload(conversationId, payload);
    logger.debug("context", "loaded", {
      conversationId,
      hasUserMessage: context.firstUserMessage.length > 0,
      hasAssistantMessage: context.lastAssistantMessage.length > 0,
    });
    return context;
  }

  // Coletas simultâneas compartilham a mesma passada: duas paginações do mesmo
  // endpoint apenas gastariam requisições e aproximariam o rate limit. O progresso
  // reportado é o da coleta que iniciou a passada.
  async listAllConversations(onProgress?: ProgressListener): Promise<Conversation[]> {
    if (this.listingPromise === null) {
      this.listingPromise = this.collectAllConversations(onProgress).finally(() => {
        this.listingPromise = null;
      });
    } else {
      logger.info("inventory", "list_joined_in_flight");
    }

    return this.listingPromise;
  }

  private async collectAllConversations(
    onProgress?: ProgressListener,
  ): Promise<Conversation[]> {
    logger.info("inventory", "list_started");
    // O total só é conhecido ao fim da paginação; o progresso reporta apenas o
    // acumulado (`total: 0`).
    this.beginProgress(onProgress, 0);
    const found: Conversation[] = [];
    const seenIds = new Set<ConversationId>();
    let offset = 0;
    let page = 0;

    for (;;) {
      const url = new URL("/backend-api/conversations", CHATGPT_ORIGIN);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(LIST_PAGE_SIZE));
      url.searchParams.set("order", "updated");
      url.searchParams.set("is_archived", "false");
      url.searchParams.set("is_starred", "false");

      const payload = await this.fetchJson(url, { method: "GET" });
      if (!isObject(payload)) {
        throw new IntegrationError("A listagem de conversas retornou um formato inválido.");
      }

      const rawItems = arrayValue(payload.items);
      const pageItems = rawItems
        .map(conversationFromPayload)
        .filter((item): item is Conversation => item !== null);
      const newItems = pageItems.filter((item) => !seenIds.has(item.id));
      for (const item of newItems) {
        seenIds.add(item.id);
        found.push(item);
      }

      page += 1;
      this.progressDone = found.length;
      this.reportProgress("working", null);
      logger.debug("inventory", "page_loaded", {
        page,
        offset,
        items: rawItems.length,
        newItems: newItems.length,
      });

      // O campo `total` da resposta não é contagem real (docs/chatgpt-integration.md);
      // o fim da lista é uma página com menos itens que o limite solicitado.
      if (rawItems.length < LIST_PAGE_SIZE) {
        break;
      }

      if (newItems.length === 0) {
        logger.warn("inventory", "page_without_new_items", { page, offset });
        break;
      }

      offset += rawItems.length;
    }

    this.endProgress();
    logger.info("inventory", "list_completed", { pages: page, conversations: found.length });
    return found;
  }

  // Revalidação em lote: uma passada pela listagem resolve o vínculo com Projeto
  // de todas as conversas do lote (uma requisição por página de 100) em vez de um
  // GET de detalhe por item — o endpoint de detalhe é o que sofre rate limit.
  // O dado continua vindo do servidor no momento da operação; muda a granularidade,
  // não a origem. Ids que não aparecerem na listagem caem no GET individual.
  private async loadBatchSnapshot(
    conversationIds: readonly ConversationId[],
  ): Promise<Map<ConversationId, Conversation>> {
    const snapshot = new Map<ConversationId, Conversation>();
    const pending = new Set(conversationIds);
    let offset = 0;
    let page = 0;

    try {
      // Se uma coleta completa já está em andamento, aguardá-la custa zero
      // requisição extra e é tão recente quanto abrir uma passada nova.
      if (this.listingPromise !== null) {
        logger.info("revalidation", "batch_snapshot_joined_listing", {
          requested: conversationIds.length,
        });
        for (const conversation of await this.listingPromise) {
          if (pending.delete(conversation.id)) {
            snapshot.set(conversation.id, conversation);
          }
        }
        return snapshot;
      }

      while (pending.size > 0) {
        const url = new URL("/backend-api/conversations", CHATGPT_ORIGIN);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(LIST_PAGE_SIZE));
        url.searchParams.set("order", "updated");
        url.searchParams.set("is_archived", "false");
        url.searchParams.set("is_starred", "false");

        const payload = await this.fetchJson(url, { method: "GET" });
        if (!isObject(payload)) {
          throw new IntegrationError("A revalidação em lote retornou um formato inválido.");
        }

        const rawItems = arrayValue(payload.items);
        for (const rawItem of rawItems) {
          const conversation = conversationFromPayload(rawItem);
          if (conversation !== null && pending.delete(conversation.id)) {
            snapshot.set(conversation.id, conversation);
          }
        }

        page += 1;
        // Mesma regra de fim de paginação da listagem completa: página incompleta.
        if (rawItems.length < LIST_PAGE_SIZE) {
          break;
        }
        offset += rawItems.length;
      }
    } catch (error) {
      // Sem snapshot, cada item volta a ser revalidado individualmente: mais lento,
      // porém nunca menos seguro que o comportamento anterior.
      logger.warn("revalidation", "batch_snapshot_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info("revalidation", "batch_snapshot_loaded", {
      pages: page,
      requested: conversationIds.length,
      resolved: snapshot.size,
      unresolved: conversationIds.length - snapshot.size,
    });
    return snapshot;
  }

  async deleteConversations(
    conversationIds: readonly ConversationId[],
    onProgress?: ProgressListener,
  ): Promise<DeleteBatchResult> {
    logger.info("delete", "batch_started", { count: conversationIds.length });
    const snapshot = await this.loadBatchSnapshot(conversationIds);
    this.beginProgress(onProgress, conversationIds.length);

    const items = await mapConcurrent(
      conversationIds,
      DELETE_CONCURRENCY,
      async (conversationId): Promise<DeleteItemResult> => {
        let title: string | null = null;
        try {
          const current =
            snapshot.get(conversationId) ?? (await this.getConversation(conversationId));
          title = current.title;
          if (current.projectId !== null) {
            logger.info("delete", "item_skipped", {
              conversationId,
              projectId: current.projectId,
            });
            return {
              conversationId,
              status: "skipped",
              reason: "in_project",
              projectId: current.projectId,
            };
          }

          const url = new URL(
            `/backend-api/conversation/id/${encodeURIComponent(conversationId)}`,
            CHATGPT_ORIGIN,
          );
          const payload = await this.fetchJson(url, { method: "DELETE" });

          if (!isObject(payload) || payload.success !== true) {
            throw new IntegrationError("A exclusão não confirmou sucesso.");
          }

          logger.info("delete", "item_succeeded", { conversationId });
          return { conversationId, status: "success" };
        } catch (error) {
          // Uma exclusão confirmada pelo servidor cuja resposta se perdeu volta
          // como 404 na retentativa: o objetivo foi alcançado. Já um 404 na
          // primeira tentativa costuma indicar id vindo de cache desatualizado,
          // e essa distinção é útil para o usuário.
          if (isDeletedOnRetry(error)) {
            logger.info("delete", "item_succeeded_on_retry", { conversationId });
            return { conversationId, status: "success" };
          }

          const reason = failureReason(error);
          const message = error instanceof Error ? error.message : "Erro desconhecido.";
          logger.error("delete", "item_failed", { conversationId, reason, message });
          return { conversationId, status: "failure", reason, message };
        } finally {
          this.progressDone += 1;
          this.reportProgress("working", title);
        }
      },
    );
    this.endProgress();

    logger.info("delete", "batch_completed", {
      succeeded: items.filter((item) => item.status === "success").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      failed: items.filter((item) => item.status === "failure").length,
    });

    return { items };
  }

  async moveConversations(
    conversationIds: readonly ConversationId[],
    destinationProjectId: ProjectId,
    onProgress?: ProgressListener,
  ): Promise<MoveBatchResult> {
    logger.info("move", "batch_started", {
      count: conversationIds.length,
      destinationProjectId,
    });
    const snapshot = await this.loadBatchSnapshot(conversationIds);
    this.beginProgress(onProgress, conversationIds.length);

    const items = await mapConcurrent(
      conversationIds,
      MOVE_CONCURRENCY,
      async (conversationId): Promise<MoveItemResult> => {
        let title: string | null = null;
        try {
          const current =
            snapshot.get(conversationId) ?? (await this.getConversation(conversationId));
          title = current.title;
          if (current.projectId !== null) {
            logger.info("move", "item_skipped", {
              conversationId,
              currentProjectId: current.projectId,
              destinationProjectId,
            });
            return {
              conversationId,
              status: "skipped",
              reason: "already_in_project",
              projectId: current.projectId,
            };
          }

          const url = new URL(
            `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
            CHATGPT_ORIGIN,
          );
          const payload = await this.fetchJson(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gizmo_id: destinationProjectId }),
          });

          if (!isObject(payload) || payload.success !== true) {
            throw new IntegrationError("A movimentação não confirmou sucesso.");
          }

          logger.info("move", "item_succeeded", { conversationId, destinationProjectId });
          return { conversationId, status: "success" };
        } catch (error) {
          const reason = failureReason(error);
          const message = error instanceof Error ? error.message : "Erro desconhecido.";
          logger.error("move", "item_failed", { conversationId, reason, message });
          return { conversationId, status: "failure", reason, message };
        } finally {
          this.progressDone += 1;
          this.reportProgress("working", title);
        }
      },
    );
    this.endProgress();

    logger.info("move", "batch_completed", {
      succeeded: items.filter((item) => item.status === "success").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      failed: items.filter((item) => item.status === "failure").length,
    });

    return { destinationProjectId, items };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken !== null) {
      return this.accessToken;
    }

    logger.debug("auth", "session_requested");
    const response = await this.scheduleRequest(() =>
      fetch(`${CHATGPT_ORIGIN}/api/auth/session`, {
        method: "GET",
        credentials: "include",
      }),
    );

    if (!response.ok) {
      throw new IntegrationError("Não foi possível obter a sessão do ChatGPT.", response.status);
    }

    const payload: unknown = await response.json();
    const token = isObject(payload) ? stringValue(payload.accessToken) : null;
    if (token === null) {
      throw new IntegrationError("Abra o ChatGPT e autentique-se antes de usar a extensão.", 401);
    }

    this.accessToken = token;
    logger.info("auth", "session_ready");
    return token;
  }

  // Falhas transitórias são retentadas com backoff exponencial e jitter. O jitter
  // evita que os itens de um mesmo lote sincronizem as retentativas e reincidam
  // no 429 em bloco.
  private async fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.attemptFetchJson(url, init, attempt);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) {
          throw error;
        }

        const delay = this.retryDelay(attempt);
        logger.warn("integration", "request_retry_scheduled", {
          method: init.method ?? "GET",
          path: url.pathname,
          attempt,
          delay,
        });
        await this.sleep(delay);
      }
    }
  }

  private async attemptFetchJson(
    url: URL,
    init: RequestInit,
    attempt: number,
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    logger.debug("integration", "request_started", {
      method: init.method ?? "GET",
      path: url.pathname,
      query: url.search,
      attempt,
    });

    let response = await this.scheduleRequest(() =>
      fetch(url, {
        ...init,
        headers,
        credentials: "include",
      }),
    );

    // Renovação de sessão continua fora do backoff: um 401 é resolvido por token
    // novo, não por espera.
    if (response.status === 401) {
      this.accessToken = null;
      const renewedToken = await this.getAccessToken();
      headers.set("Authorization", `Bearer ${renewedToken}`);
      response = await this.scheduleRequest(() =>
        fetch(url, { ...init, headers, credentials: "include" }),
      );
    }

    logger.debug("integration", "request_completed", {
      method: init.method ?? "GET",
      path: url.pathname,
      status: response.status,
      attempt,
    });

    if (response.status === 429) {
      this.rateLimitedUntil = rateLimitEnd(response, this.now());
      // `retryAfter: null` indica que a janela é o nosso padrão, não uma
      // instrução do servidor — informação necessária para calibrar a espera.
      logger.warn("integration", "rate_limit_activated", {
        path: url.pathname,
        retryAfter: response.headers.get("retry-after"),
        blockedUntil: new Date(this.rateLimitedUntil).toISOString(),
      });
    }

    if (!response.ok) {
      const responseBody = await readErrorBody(response);
      logger.error("integration", "request_failed", {
        method: init.method ?? "GET",
        path: url.pathname,
        status: response.status,
        attempt,
        responseBody,
      });
      const message =
        response.status === 429
          ? "O ChatGPT limitou temporariamente as requisições. Aguarde antes de pesquisar novamente."
          : `O ChatGPT respondeu com status ${response.status}.`;
      throw new IntegrationError(message, response.status, { attempt });
    }

    return response.json() as Promise<unknown>;
  }

  private retryDelay(attempt: number): number {
    const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    const jitter = 1 + (this.random() * 2 - 1) * RETRY_JITTER_RATIO;
    return Math.round(base * jitter);
  }

  private async scheduleRequest<T>(operation: () => Promise<T>): Promise<T> {
    const previousRequest = this.requestQueue;
    let releaseQueue: () => void = () => undefined;
    this.requestQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousRequest;
    try {
      await this.waitForRateLimitWindow();

      const waitTime = Math.max(0, this.nextRequestAt - this.now());
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
      return await operation();
    } finally {
      this.nextRequestAt = this.now() + MIN_REQUEST_INTERVAL_MS;
      releaseQueue();
    }
  }

  // A espera acontece dentro da fila serial: o lote inteiro pausa e retoma junto,
  // em vez de falhar em cascata enquanto a janela de rate limit está aberta.
  private async waitForRateLimitWindow(): Promise<void> {
    const waitMs = this.rateLimitedUntil - this.now();
    if (waitMs <= 0) {
      return;
    }

    if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
      throw new IntegrationError(
        "O ChatGPT limitou as requisições por um período longo. Tente novamente mais tarde.",
        429,
        { retryable: false },
      );
    }

    logger.warn("integration", "rate_limit_wait_started", { waitMs });
    this.reportProgress("waiting", null);
    await this.sleep(waitMs);
    this.rateLimitedUntil = 0;
    logger.info("integration", "rate_limit_wait_finished", { waitMs });
  }

  private beginProgress(listener: ProgressListener | undefined, total: number): void {
    this.progressListener = listener ?? null;
    this.progressDone = 0;
    this.progressTotal = total;
  }

  private endProgress(): void {
    this.progressListener = null;
    this.progressDone = 0;
    this.progressTotal = 0;
  }

  private reportProgress(phase: "working" | "waiting", title: string | null): void {
    this.progressListener?.({
      phase,
      done: this.progressDone,
      total: this.progressTotal,
      title,
    });
  }
}

function rateLimitEnd(response: Response, now: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return now + seconds * 1_000;
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > now) {
      return date;
    }
  }

  return now + 60_000;
}

// Erros que não são `IntegrationError` vêm do próprio `fetch` (rede indisponível)
// e são transitórios por natureza.
function isRetryable(error: unknown): boolean {
  return error instanceof IntegrationError ? error.retryable : true;
}

async function readErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { contentType: contentType || "unknown" };
  }

  try {
    return (await response.clone().json()) as unknown;
  } catch {
    return { malformedJson: true };
  }
}

function isDeletedOnRetry(error: unknown): boolean {
  return error instanceof IntegrationError && error.status === 404 && error.attempt > 1;
}

function failureReason(error: unknown): OperationFailureReason {
  if (!(error instanceof IntegrationError) || error.status === null) {
    return error instanceof IntegrationError ? "integration_error" : "unknown";
  }

  switch (error.status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "integration_error";
  }
}
