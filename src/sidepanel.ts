import type { Conversation, MoveBatchResult, Project } from "./domain.js";
import type {
  DebugState,
  ExtensionRequest,
  ExtensionResponse,
  ResponseData,
} from "./messages.js";
import { SearchSessionCache, type CachedSearchResult } from "./search-cache.js";

const searchForm = requiredElement<HTMLFormElement>("search-form");
const searchQuery = requiredElement<HTMLInputElement>("search-query");
const searchButton = requiredElement<HTMLButtonElement>("search-button");
const conversationList = requiredElement<HTMLDivElement>("conversation-list");
const selectionCount = requiredElement<HTMLParagraphElement>("selection-count");
const selectAllButton = requiredElement<HTMLButtonElement>("select-all-button");
const resultSummary = requiredElement<HTMLParagraphElement>("result-summary");
const projectSelect = requiredElement<HTMLSelectElement>("project-select");
const moveSummary = requiredElement<HTMLParagraphElement>("move-summary");
const moveButton = requiredElement<HTMLButtonElement>("move-button");
const notice = requiredElement<HTMLDivElement>("notice");
const debugToggle = requiredElement<HTMLButtonElement>("debug-toggle");
const debugOutput = requiredElement<HTMLDivElement>("debug-output");
const debugBadge = requiredElement<HTMLElement>("debug-title").querySelector<HTMLElement>(
  ".badge",
);
const connectionStatus = requiredElement<HTMLElement>("connection-status");

let conversations: Conversation[] = [];
let filteredCount = 0;
let selectedIds = new Set<string>();
let projects: Project[] = [];
let busy = false;
const searchCache = new SearchSessionCache();

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void search();
});

selectAllButton.addEventListener("click", () => {
  const allSelected =
    conversations.length > 0 && conversations.every((item) => selectedIds.has(item.id));
  selectedIds = allSelected
    ? new Set<string>()
    : new Set(conversations.map((conversation) => conversation.id));
  renderConversations();
  updateActions();
});

projectSelect.addEventListener("change", updateActions);
moveButton.addEventListener("click", () => void moveSelected());
debugToggle.addEventListener("click", () => void toggleDebug());

void initialize();

async function initialize(): Promise<void> {
  setBusy(true, "Indexando Projetos…");
  try {
    await Promise.all([loadProjects(), refreshDebug()]);
    setConnection("Pronto");
  } catch (error) {
    setConnection("Atenção");
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

async function search(): Promise<void> {
  const query = searchQuery.value.trim();
  if (query.length === 0 || busy) {
    return;
  }

  setBusy(true, "Pesquisando todas as páginas…");
  hideNotice();
  const cached = searchCache.get(query);

  if (cached !== null) {
    recordCacheEvent("hit", { query, conversations: cached.conversations.length });
    conversations = cached.conversations;
    filteredCount = cached.filteredCount;
    selectedIds = new Set<string>();
    renderConversations();
    updateActions();
    showNotice("Resultados carregados do cache temporário.", false);
    setBusy(false);
    return;
  }

  recordCacheEvent("miss", { query });
  conversationList.replaceChildren(createEmptyState("Pesquisando conversas…"));

  try {
    const result = await sendMessage<CachedSearchResult>({ type: "search", query });
    conversations = result.conversations;
    filteredCount = result.filteredCount;
    searchCache.set(query, result);
    selectedIds = new Set<string>();
    renderConversations();
    updateActions();
  } catch (error) {
    conversations = [];
    filteredCount = 0;
    selectedIds.clear();
    renderConversations();
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

async function loadProjects(): Promise<void> {
  projects = await sendMessage<Project[]>({ type: "list-projects" });
  projectSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent =
    projects.length === 0 ? "Nenhum Projeto encontrado" : "Escolha um Projeto";
  projectSelect.append(placeholder);

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.append(option);
  }

  projectSelect.disabled = projects.length === 0;
  updateActions();
}

async function moveSelected(): Promise<void> {
  const destinationProjectId = projectSelect.value;
  if (selectedIds.size === 0 || destinationProjectId.length === 0 || busy) {
    return;
  }

  setBusy(true, `Movendo ${selectedIds.size} conversa(s)…`);
  hideNotice();

  try {
    const result = await sendMessage<MoveBatchResult>({
      type: "move",
      conversationIds: [...selectedIds],
      destinationProjectId,
    });
    applyMoveResult(result);
  } catch (error) {
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

function applyMoveResult(result: MoveBatchResult): void {
  const succeededIds = new Set(
    result.items
      .filter((item) => item.status === "success" || item.status === "skipped")
      .map((item) => item.conversationId),
  );
  const successCount = result.items.filter((item) => item.status === "success").length;
  const skippedCount = result.items.filter((item) => item.status === "skipped").length;
  const failedCount = result.items.filter((item) => item.status === "failure").length;

  searchCache.removeConversations(succeededIds);
  recordCacheEvent("items_removed", { count: succeededIds.size });

  conversations = conversations.filter((conversation) => !succeededIds.has(conversation.id));
  selectedIds = new Set(
    [...selectedIds].filter((conversationId) => !succeededIds.has(conversationId)),
  );
  renderConversations();
  updateActions();

  const parts = [`${successCount} movida(s)`];
  if (skippedCount > 0) {
    parts.push(`${skippedCount} ignorada(s) por já estar(em) em Projeto`);
  }
  if (failedCount > 0) {
    parts.push(`${failedCount} falha(s)`);
  }
  showNotice(`${parts.join(" · ")}.`, failedCount > 0);
}

function renderConversations(): void {
  conversationList.replaceChildren();

  if (conversations.length === 0) {
    conversationList.append(
      createEmptyState(
        filteredCount > 0
          ? "Todas as conversas encontradas já pertencem a Projetos."
          : "Nenhuma conversa disponível para esta pesquisa.",
      ),
    );
  } else {
    for (const conversation of conversations) {
      conversationList.append(createConversationRow(conversation));
    }
  }

  resultSummary.textContent =
    filteredCount > 0
      ? `Todas as páginas foram verificadas · ${filteredCount} conversa(s) em Projetos foram ocultadas`
      : conversations.length > 0
        ? "Todas as páginas foram verificadas"
        : "";
}

function createConversationRow(conversation: Conversation): HTMLDivElement {
  const row = document.createElement("div");
  row.className = selectedIds.has(conversation.id)
    ? "conversation selected"
    : "conversation";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedIds.has(conversation.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedIds.add(conversation.id);
    } else {
      selectedIds.delete(conversation.id);
    }
    row.classList.toggle("selected", checkbox.checked);
    updateActions();
  });

  const content = document.createElement("span");
  content.className = "conversation-content";
  const top = document.createElement("span");
  top.className = "conversation-top";
  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = conversation.title;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "Fora de Projeto";
  top.append(title, badge);

  const preview = document.createElement("span");
  preview.className = "conversation-preview";
  preview.textContent = conversation.preview || "Sem texto inicial disponível.";
  content.append(top, preview);
  row.append(checkbox, content);

  const openButton = document.createElement("button");
  openButton.className = "conversation-open";
  openButton.type = "button";
  openButton.textContent = "↗";
  openButton.setAttribute("aria-label", `Abrir conversa: ${conversation.title}`);
  openButton.title = "Abrir conversa nesta aba";
  openButton.addEventListener("click", () => void openConversation(conversation.id));
  row.append(openButton);

  return row;
}

async function openConversation(conversationId: string): Promise<void> {
  try {
    await sendMessage<{ opened: true }>({ type: "open-conversation", conversationId });
  } catch (error) {
    showNotice(errorMessage(error), true);
  }
}

function updateActions(): void {
  const allSelected =
    conversations.length > 0 && conversations.every((item) => selectedIds.has(item.id));
  selectionCount.textContent = `${conversations.length} conversa(s) disponível(is) · ${selectedIds.size} selecionada(s)`;
  selectAllButton.textContent = allSelected ? "Limpar seleção" : "Selecionar todas";
  selectAllButton.disabled = busy || conversations.length === 0;
  projectSelect.disabled = busy || projects.length === 0;
  moveButton.disabled = busy || selectedIds.size === 0 || projectSelect.value.length === 0;
  moveButton.textContent =
    selectedIds.size > 0 ? `Mover ${selectedIds.size} conversa(s)` : "Mover conversas";
  moveSummary.textContent =
    selectedIds.size === 0
      ? "Selecione conversas e um Projeto de destino."
      : projectSelect.value.length === 0
        ? `${selectedIds.size} conversa(s) selecionada(s). Escolha o destino.`
        : `${selectedIds.size} conversa(s) serão revalidadas e movidas.`;
}

async function toggleDebug(): Promise<void> {
  const enabled = debugToggle.getAttribute("aria-checked") !== "true";
  try {
    const state = await sendMessage<DebugState>({ type: "set-debug", enabled });
    renderDebug(state);
  } catch (error) {
    showNotice(errorMessage(error), true);
  }
}

async function refreshDebug(): Promise<void> {
  const state = await sendMessage<DebugState>({ type: "get-debug-state" });
  renderDebug(state);
}

async function refreshDebugSafely(): Promise<void> {
  try {
    await refreshDebug();
  } catch {
    // A falha principal já é apresentada pelo fluxo que originou a atualização.
  }
}

function renderDebug(state: DebugState): void {
  debugToggle.setAttribute("aria-checked", String(state.enabled));
  debugToggle.setAttribute(
    "aria-label",
    state.enabled ? "Desativar modo debug" : "Ativar modo debug",
  );
  if (debugBadge !== null) {
    debugBadge.textContent = state.enabled ? "ATIVO" : "INATIVO";
  }

  debugOutput.replaceChildren();
  const visibleEvents = state.events.slice(-30);
  if (visibleEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "debug-line";
    empty.textContent = state.enabled ? "Aguardando eventos…" : "Modo debug desativado.";
    debugOutput.append(empty);
    return;
  }

  for (const event of visibleEvents) {
    const line = document.createElement("div");
    const time = document.createElement("span");
    time.className = "debug-time";
    time.textContent = new Date(event.timestamp).toLocaleTimeString("pt-BR");
    line.append(time, ` ${event.level} ${event.category}.${event.name}`);
    if (Object.keys(event.context).length > 0) {
      line.append(` ${JSON.stringify(event.context)}`);
    }
    debugOutput.append(line);
  }
  debugOutput.scrollTop = debugOutput.scrollHeight;
}

function setBusy(value: boolean, label?: string): void {
  busy = value;
  searchButton.disabled = value;
  searchQuery.disabled = value;
  setConnection(value ? (label ?? "Processando…") : "Pronto");
  updateActions();
}

function setConnection(text: string): void {
  const dot = connectionStatus.querySelector(".status-dot");
  connectionStatus.replaceChildren();
  if (dot !== null) {
    connectionStatus.append(dot);
  }
  connectionStatus.append(text);
}

function showNotice(message: string, isError: boolean): void {
  notice.textContent = message;
  notice.className = isError ? "notice visible error" : "notice visible";
}

function hideNotice(): void {
  notice.textContent = "";
  notice.className = "notice";
}

function createEmptyState(message: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}

async function sendMessage<T extends ResponseData>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as ExtensionResponse | undefined;
  if (response === undefined) {
    throw new Error("A extensão não respondeu. Recarregue-a no Chrome.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data as T;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Elemento obrigatório ausente: ${id}`);
  }
  return element as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function recordCacheEvent(
  name: "hit" | "miss" | "items_removed",
  context: Record<string, unknown>,
): void {
  void sendMessage<{ recorded: true }>({
    type: "record-cache-event",
    name,
    context,
  }).catch(() => {
    // O cache continua funcional mesmo quando o logger não está disponível.
  });
}

