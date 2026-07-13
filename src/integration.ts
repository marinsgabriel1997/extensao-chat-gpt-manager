import type {
  Conversation,
  ConversationId,
  MoveBatchResult,
  MoveFailureReason,
  MoveItemResult,
  Project,
  ProjectId,
} from "./domain.js";
import { uniqueConversations } from "./domain.js";
import { logger } from "./logger.js";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const MOVE_CONCURRENCY = 1;
const MIN_REQUEST_INTERVAL_MS = 500;

type JsonObject = Record<string, unknown>;

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
    preview: firstVisibleUserText(payload),
    projectId: projectIdFromPayload(payload),
  };
}

export function conversationFromSearchPayload(payload: unknown): Conversation | null {
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
    preview: stringValue(searchPayload.snippet) ?? "",
    projectId: null,
  };
}

function firstVisibleUserText(payload: JsonObject): string {
  if (!isObject(payload.mapping)) {
    return "";
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

  path.reverse();
  for (const node of path) {
    const text = visibleUserTextFromNode(node);
    if (text !== null) {
      return text;
    }
  }

  return "";
}

function visibleUserTextFromNode(node: JsonObject): string | null {
  if (!isObject(node.message)) {
    return null;
  }

  const message = node.message;
  const author = isObject(message.author) ? message.author : {};
  const content = isObject(message.content) ? message.content : {};
  const metadata = isObject(message.metadata) ? message.metadata : {};

  if (
    author.role !== "user" ||
    content.content_type !== "text" ||
    metadata.is_visually_hidden_from_conversation === true
  ) {
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
  private readonly projectConversationIds = new Set<ConversationId>();
  private projectsPromise: Promise<Project[]> | null = null;

  async searchEligibleConversations(query: string): Promise<{
    conversations: Conversation[];
    filteredCount: number;
  }> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new Error("Digite um texto para pesquisar.");
    }

    logger.info("search", "started", { query: normalizedQuery });
    await this.listProjects();
    const found: Conversation[] = [];
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
        .map(conversationFromSearchPayload)
        .filter((item): item is Conversation => item !== null);
      found.push(...pageItems);
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

    const unique = uniqueConversations(found);
    const eligible = unique.filter(
      (conversation) => !this.projectConversationIds.has(conversation.id),
    );
    const filteredCount = unique.length - eligible.length;

    logger.info("search", "completed", {
      pages: page,
      found: unique.length,
      eligible: eligible.length,
      filtered: filteredCount,
    });

    return { conversations: eligible, filteredCount };
  }

  async listProjects(): Promise<Project[]> {
    if (this.projectsPromise === null) {
      this.projectsPromise = this.loadProjectsAndConversationIndex().catch((error: unknown) => {
        this.projectsPromise = null;
        this.projectConversationIds.clear();
        throw error;
      });
    }

    return this.projectsPromise;
  }

  private async loadProjectsAndConversationIndex(): Promise<Project[]> {
    logger.info("projects", "list_started");
    const projects: Project[] = [];
    const projectContinuations: Array<{ projectId: ProjectId; cursor: string }> = [];
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
      for (const rawItem of arrayValue(payload.items)) {
        this.collectSidebarConversationIds(rawItem, projectContinuations);
      }
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
    for (const continuation of projectContinuations) {
      await this.loadRemainingProjectConversationIds(
        continuation.projectId,
        continuation.cursor,
      );
    }
    unique.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    logger.info("projects", "list_completed", {
      pages: page,
      projects: unique.length,
      indexedConversations: this.projectConversationIds.size,
    });
    return unique;
  }

  private collectSidebarConversationIds(
    rawItem: unknown,
    continuations: Array<{ projectId: ProjectId; cursor: string }>,
  ): void {
    if (!isObject(rawItem) || !isObject(rawItem.gizmo) || !isObject(rawItem.gizmo.gizmo)) {
      return;
    }

    const projectId = stringValue(rawItem.gizmo.gizmo.id);
    if (projectId === null || !isObject(rawItem.conversations)) {
      return;
    }

    for (const rawConversation of arrayValue(rawItem.conversations.items)) {
      if (isObject(rawConversation)) {
        const conversationId = stringValue(rawConversation.id);
        if (conversationId !== null) {
          this.projectConversationIds.add(conversationId);
        }
      }
    }

    const cursor = stringValue(rawItem.conversations.cursor);
    if (cursor !== null) {
      continuations.push({ projectId, cursor });
    }
  }

  private async loadRemainingProjectConversationIds(
    projectId: ProjectId,
    initialCursor: string,
  ): Promise<void> {
    let cursor: string | null = initialCursor;
    let page = 1;
    const visitedCursors = new Set<string>();

    while (cursor !== null && !visitedCursors.has(cursor)) {
      visitedCursors.add(cursor);
      const url = new URL(
        `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations`,
        CHATGPT_ORIGIN,
      );
      url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", "5");
      url.searchParams.set("owned_only", "true");

      const payload = await this.fetchJson(url, { method: "GET" });
      if (!isObject(payload)) {
        throw new IntegrationError(
          "A paginação de conversas do Projeto retornou um formato inválido.",
        );
      }

      const items = arrayValue(payload.items);
      for (const rawConversation of items) {
        if (isObject(rawConversation)) {
          const conversationId = stringValue(rawConversation.id);
          if (conversationId !== null) {
            this.projectConversationIds.add(conversationId);
          }
        }
      }

      page += 1;
      logger.debug("projects", "conversation_page_loaded", {
        projectId,
        page,
        items: items.length,
      });
      cursor = stringValue(payload.cursor);
    }
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

  async moveConversations(
    conversationIds: readonly ConversationId[],
    destinationProjectId: ProjectId,
  ): Promise<MoveBatchResult> {
    logger.info("move", "batch_started", {
      count: conversationIds.length,
      destinationProjectId,
    });

    const items = await mapConcurrent(
      conversationIds,
      MOVE_CONCURRENCY,
      async (conversationId): Promise<MoveItemResult> => {
        try {
          const current = await this.getConversation(conversationId);
          if (current.projectId !== null) {
            this.projectConversationIds.add(conversationId);
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
          this.projectConversationIds.add(conversationId);
          return { conversationId, status: "success" };
        } catch (error) {
          const reason = failureReason(error);
          const message = error instanceof Error ? error.message : "Erro desconhecido.";
          logger.error("move", "item_failed", { conversationId, reason, message });
          return { conversationId, status: "failure", reason, message };
        }
      },
    );

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

  private async fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    logger.debug("integration", "request_started", {
      method: init.method ?? "GET",
      path: url.pathname,
      query: url.search,
    });

    let response = await this.scheduleRequest(() =>
      fetch(url, {
        ...init,
        headers,
        credentials: "include",
      }),
    );

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
    });

    if (response.status === 429) {
      this.rateLimitedUntil = rateLimitEnd(response);
      logger.warn("integration", "rate_limit_activated", {
        blockedUntil: new Date(this.rateLimitedUntil).toISOString(),
      });
    }

    if (!response.ok) {
      const responseBody = await readErrorBody(response);
      logger.error("integration", "request_failed", {
        method: init.method ?? "GET",
        path: url.pathname,
        status: response.status,
        responseBody,
      });
      const message =
        response.status === 429
          ? "O ChatGPT limitou temporariamente as requisições. Aguarde antes de pesquisar novamente."
          : `O ChatGPT respondeu com status ${response.status}.`;
      throw new IntegrationError(message, response.status);
    }

    return response.json() as Promise<unknown>;
  }

  private async scheduleRequest<T>(operation: () => Promise<T>): Promise<T> {
    const previousRequest = this.requestQueue;
    let releaseQueue: () => void = () => undefined;
    this.requestQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousRequest;
    try {
      if (Date.now() < this.rateLimitedUntil) {
        throw new IntegrationError(
          "O ChatGPT limitou temporariamente as requisições. Aguarde antes de tentar novamente.",
          429,
        );
      }

      const waitTime = Math.max(0, this.nextRequestAt - Date.now());
      if (waitTime > 0) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, waitTime));
      }
      return await operation();
    } finally {
      this.nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
      releaseQueue();
    }
  }
}

function rateLimitEnd(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + seconds * 1_000;
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > Date.now()) {
      return date;
    }
  }

  return Date.now() + 60_000;
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

function failureReason(error: unknown): MoveFailureReason {
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
