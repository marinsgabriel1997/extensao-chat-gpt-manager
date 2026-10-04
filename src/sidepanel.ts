import {
  countByFolder,
  dragSet,
  filterByFolder,
  filterByTitle,
  selectRange,
  type Conversation,
  type ConversationContext,
  type ConversationFolder,
  type ConversationSearchHit,
  type DeleteBatchResult,
  type MoveBatchResult,
  type Project,
  type ProjectId,
} from "./domain.js";
import type {
  ConversationInventory,
  DebugState,
  ExtensionEvent,
  ExtensionRequest,
  ExtensionResponse,
  ResponseData,
} from "./messages.js";
import { SearchSessionCache, type CachedSearchResult } from "./search-cache.js";

type SearchMode = "title" | "content";

interface ContentSearchState {
  query: string;
  hits: ConversationSearchHit[];
}

// Linha da lista: uma conversa do inventário (com o trecho da pesquisa, quando
// houver) ou um resultado da pesquisa ausente do inventário local.
type VisibleRow =
  | { kind: "conversation"; conversation: Conversation; snippet: string | null }
  | { kind: "missing"; hit: ConversationSearchHit };

// Itens enviados para uma operação em andamento ficam travados até a resposta:
// não mudam de seleção, não são arrastados e não iniciam outra operação.
interface PendingOperation {
  kind: "move" | "delete";
  ids: ReadonlySet<string>;
}

type ContextState =
  | { status: "loading" }
  | { status: "loaded"; context: ConversationContext }
  | { status: "error"; message: string };

const tabOrganizeButton = requiredElement<HTMLButtonElement>("tab-organize");
const tabDebugButton = requiredElement<HTMLButtonElement>("tab-debug");
const organizeToolbar = requiredElement<HTMLElement>("organize-toolbar");
const viewOrganize = requiredElement<HTMLElement>("view-organize");
const viewDebug = requiredElement<HTMLElement>("view-debug");
const notice = requiredElement<HTMLDivElement>("notice");
const loadPanel = requiredElement<HTMLDivElement>("load-panel");
const workspace = requiredElement<HTMLElement>("workspace");
const searchForm = requiredElement<HTMLFormElement>("search-form");
const searchQuery = requiredElement<HTMLInputElement>("search-query");
const modeTitleButton = requiredElement<HTMLButtonElement>("mode-title");
const modeContentButton = requiredElement<HTMLButtonElement>("mode-content");
const searchSubmit = requiredElement<HTMLButtonElement>("search-submit");
const searchNote = requiredElement<HTMLParagraphElement>("search-note");
const foldersToggle = requiredElement<HTMLButtonElement>("folders-toggle");
const foldersActive = requiredElement<HTMLSpanElement>("folders-active");
const folderList = requiredElement<HTMLDivElement>("folder-list");
const listSummary = requiredElement<HTMLParagraphElement>("list-summary");
const freshness = requiredElement<HTMLParagraphElement>("freshness");
const syncButton = requiredElement<HTMLButtonElement>("sync-button");
const selectVisibleButton = requiredElement<HTMLButtonElement>("select-visible");
const conversationList = requiredElement<HTMLDivElement>("conversation-list");
const actionBar = requiredElement<HTMLDivElement>("action-bar");
const moveMenu = requiredElement<HTMLDivElement>("move-menu");
const moveFilter = requiredElement<HTMLInputElement>("move-filter");
const moveOptions = requiredElement<HTMLDivElement>("move-options");
const selectionSummary = requiredElement<HTMLSpanElement>("selection-summary");
const moveOpenButton = requiredElement<HTMLButtonElement>("move-open");
const deleteButton = requiredElement<HTMLButtonElement>("delete-button");
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const debugToggle = requiredElement<HTMLButtonElement>("debug-toggle");
const debugOutput = requiredElement<HTMLDivElement>("debug-output");
const debugBadge = requiredElement<HTMLElement>("debug-title").querySelector<HTMLElement>(
  ".badge",
);
const connectionStatus = requiredElement<HTMLElement>("connection-status");

let inventory: Conversation[] = [];
let projects: Project[] = [];
let projectNames = new Map<ProjectId, string>();
let fetchedAt: string | null = null;
let inventoryLoaded = false;
let busy = false;
let pendingOperation: PendingOperation | null = null;

let selectedIds = new Set<string>();
let selectionAnchorId: string | null = null;
let activeFolder: ConversationFolder = { kind: "outside_project" };
let searchMode: SearchMode = "title";
let contentSearch: ContentSearchState | null = null;
let foldersCollapsed = false;

let draggedIds: string[] | null = null;
let dropTarget: HTMLButtonElement | null = null;
let renderDeferred = false;

const expandedIds = new Set<string>();
// Contexto das conversas fica somente em memória: o cache persistente guarda
// apenas metadados, nunca conteúdo de mensagens.
const contextStates = new Map<string, ContextState>();
const searchCache = new SearchSessionCache();

tabOrganizeButton.addEventListener("click", () => setActiveTab("organize"));
tabDebugButton.addEventListener("click", () => setActiveTab("debug"));
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (searchMode === "content") {
    void runContentSearch();
  }
});
searchQuery.addEventListener("input", () => {
  if (searchMode === "content" && searchQuery.value.trim().length === 0) {
    contentSearch = null;
  }
  if (searchMode === "title" || contentSearch === null) {
    renderList();
    updateControls();
  }
});
modeTitleButton.addEventListener("click", () => setSearchMode("title"));
modeContentButton.addEventListener("click", () => setSearchMode("content"));
foldersToggle.addEventListener("click", () => {
  foldersCollapsed = !foldersCollapsed;
  renderFolders();
});
syncButton.addEventListener("click", () => void loadInventory());
selectVisibleButton.addEventListener("click", toggleVisibleSelection);
moveOpenButton.addEventListener("click", toggleMoveMenu);
moveFilter.addEventListener("input", renderMoveOptions);
moveFilter.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    moveOptions.querySelector<HTMLButtonElement>(".move-option")?.click();
  }
});
deleteButton.addEventListener("click", () => void deleteConversations([...selectedIds]));
clearButton.addEventListener("click", clearSelection);
debugToggle.addEventListener("click", () => void toggleDebug());

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  if (!moveMenu.hidden) {
    closeMoveMenu();
    moveOpenButton.focus();
    return;
  }
  // Esc dentro de um campo de texto pertence ao campo (limpar a busca).
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type !== "checkbox") {
    return;
  }
  if (selectedIds.size > 0) {
    clearSelection();
  }
});

// O handler da pasta roda antes deste (bubbling); aqui só limpamos o destaque
// quando o cursor sai de qualquer pasta que aceite soltura.
document.addEventListener("dragover", (event) => {
  if (draggedIds === null) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || target.closest(".folder[data-project-id]") === null) {
    clearDropTarget();
  }
});

// Progresso das operações longas. A guarda por `busy` evita que um evento
// atrasado sobrescreva o estado "Pronto" depois do fim da operação.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (busy && isProgressEvent(message)) {
    setConnection(progressLabel(message));
  }
});

void initialize();

// Abrir o painel lê somente o cache local; nenhuma chamada ao ChatGPT é feita
// sem ação explícita do usuário.
async function initialize(): Promise<void> {
  try {
    await refreshDebug();
  } catch (error) {
    setConnection("Atenção");
    showNotice(errorMessage(error), true);
  }
  await loadCachedInventory();
}

// A aba de debug substitui a tela de organização inteira; o estado da
// organização (pasta, seleção, busca) é preservado ao voltar.
function setActiveTab(tab: "organize" | "debug"): void {
  const isDebug = tab === "debug";
  organizeToolbar.hidden = isDebug;
  viewOrganize.hidden = isDebug;
  actionBar.hidden = isDebug;
  viewDebug.hidden = !isDebug;
  tabOrganizeButton.classList.toggle("active", !isDebug);
  tabDebugButton.classList.toggle("active", isDebug);
  tabOrganizeButton.setAttribute("aria-selected", String(!isDebug));
  tabDebugButton.setAttribute("aria-selected", String(isDebug));
  if (isDebug) {
    closeMoveMenu();
    void refreshDebugSafely();
  }
}

// --- Inventário -------------------------------------------------------------

async function loadCachedInventory(): Promise<void> {
  try {
    const result = await sendMessage<{ inventory: ConversationInventory | null }>({
      type: "get-cached-conversations",
    });
    if (result.inventory !== null) {
      applyInventory(result.inventory);
      return;
    }
    showLoadPrompt("Nenhum dado local disponível.", "Carregar conversas");
  } catch (error) {
    showLoadPrompt("Não foi possível ler os dados locais.", "Carregar conversas");
    showNotice(errorMessage(error), true);
  }
}

async function loadInventory(): Promise<void> {
  if (busy) {
    return;
  }

  setBusy(true, "Carregando todas as conversas…");
  hideNotice();
  if (!inventoryLoaded) {
    loadPanel.replaceChildren(createEmptyState("Carregando conversas do ChatGPT…"));
  }

  try {
    const result = await sendMessage<ConversationInventory>({
      type: "list-all-conversations",
      refresh: true,
    });
    applyInventory(result);
  } catch (error) {
    if (!inventoryLoaded) {
      showLoadPrompt("Não foi possível carregar as conversas.", "Tentar novamente");
    }
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

function showLoadPrompt(message: string, label: string): void {
  workspace.hidden = true;
  loadPanel.hidden = false;

  const element = document.createElement("div");
  element.className = "empty-state";
  const text = document.createElement("p");
  text.textContent = message;
  const action = document.createElement("button");
  action.className = "button button-primary";
  action.type = "button";
  action.textContent = label;
  action.style.marginTop = "10px";
  action.addEventListener("click", () => void loadInventory());
  element.append(text, action);

  loadPanel.replaceChildren(element);
}

function applyInventory(result: ConversationInventory): void {
  inventory = result.conversations;
  projects = result.projects;
  projectNames = new Map(result.projects.map((project) => [project.id, project.name]));
  fetchedAt = result.fetchedAt;
  inventoryLoaded = true;
  loadPanel.hidden = true;
  workspace.hidden = false;

  if (activeFolder.kind === "project" && !hasFolder(activeFolder.projectId)) {
    activeFolder = { kind: "outside_project" };
  }

  // Reconciliação preserva a seleção manual por interseção: somente ids que
  // continuam existentes e fora de projeto permanecem selecionados.
  const selectable = selectableIds();
  const previousSize = selectedIds.size;
  selectedIds = new Set([...selectedIds].filter((id) => selectable.has(id)));
  const removed = previousSize - selectedIds.size;
  if (removed > 0) {
    showNotice(
      `${removed} conversa(s) saíram da seleção porque foram removidas ou entraram em Projetos.`,
      false,
    );
  }

  renderAll();
}

function hasFolder(projectId: ProjectId): boolean {
  return (
    projectNames.has(projectId) ||
    inventory.some((conversation) => conversation.projectId === projectId)
  );
}

function selectableIds(): Set<string> {
  return new Set(
    inventory
      .filter((conversation) => conversation.projectId === null)
      .map((conversation) => conversation.id),
  );
}

// --- Visão atual --------------------------------------------------------------

function visibleRows(): VisibleRow[] {
  const scoped = filterByFolder(inventory, activeFolder);

  if (searchMode === "content" && contentSearch !== null) {
    const scopedById = new Map(scoped.map((conversation) => [conversation.id, conversation]));
    const inventoryIds = new Set(inventory.map((conversation) => conversation.id));
    const rows: VisibleRow[] = [];
    for (const hit of contentSearch.hits) {
      const conversation = scopedById.get(hit.id);
      if (conversation !== undefined) {
        rows.push({ kind: "conversation", conversation, snippet: hit.snippet });
      } else if (!inventoryIds.has(hit.id) && activeFolder.kind === "all") {
        // Sem inventário não há como saber a pasta: só aparece em "Todas".
        rows.push({ kind: "missing", hit });
      }
    }
    return rows;
  }

  const query = searchMode === "title" ? searchQuery.value : "";
  return filterByTitle(scoped, query).map((conversation) => ({
    kind: "conversation",
    conversation,
    snippet: null,
  }));
}

function visibleConversations(): Conversation[] {
  return visibleRows()
    .filter((row): row is Extract<VisibleRow, { kind: "conversation" }> => row.kind === "conversation")
    .map((row) => row.conversation);
}

function missingHitCount(): number {
  if (contentSearch === null) {
    return 0;
  }
  const inventoryIds = new Set(inventory.map((conversation) => conversation.id));
  return contentSearch.hits.filter((hit) => !inventoryIds.has(hit.id)).length;
}

function folderLabel(folder: ConversationFolder): string {
  switch (folder.kind) {
    case "outside_project":
      return "Sem projeto";
    case "all":
      return "Todas";
    case "project":
      return projectNames.get(folder.projectId) ?? "Projeto não listado";
  }
}

function isActiveFolder(folder: ConversationFolder): boolean {
  if (folder.kind === "project") {
    return activeFolder.kind === "project" && activeFolder.projectId === folder.projectId;
  }
  return activeFolder.kind === folder.kind;
}

function setActiveFolder(folder: ConversationFolder): void {
  activeFolder = folder;
  selectionAnchorId = null;
  renderAll();
}

function setSearchMode(mode: SearchMode): void {
  searchMode = mode;
  const isContent = mode === "content";
  modeTitleButton.classList.toggle("active", !isContent);
  modeContentButton.classList.toggle("active", isContent);
  modeTitleButton.setAttribute("aria-pressed", String(!isContent));
  modeContentButton.setAttribute("aria-pressed", String(isContent));
  searchSubmit.hidden = !isContent;
  searchQuery.placeholder = isContent
    ? "Pesquisar no conteúdo (Enter)"
    : "Filtrar por título";
  if (!isContent) {
    contentSearch = null;
  }
  renderAll();
  searchQuery.focus();
}

async function runContentSearch(): Promise<void> {
  const query = searchQuery.value.trim();
  if (query.length === 0 || busy) {
    return;
  }

  hideNotice();
  const cached = searchCache.get(query);
  if (cached !== null) {
    recordCacheEvent("hit", { query, hits: cached.hits.length });
    contentSearch = { query, hits: cached.hits };
    renderAll();
    return;
  }

  recordCacheEvent("miss", { query });
  setBusy(true, "Pesquisando no conteúdo…");
  try {
    const result = await sendMessage<CachedSearchResult>({ type: "search", query });
    searchCache.set(query, result);
    contentSearch = { query, hits: result.hits };
    renderAll();
  } catch (error) {
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

// --- Renderização ----------------------------------------------------------------

function renderAll(): void {
  renderFolders();
  renderList();
  updateControls();
}

function renderFolders(): void {
  const counts = countByFolder(inventory, projects);
  foldersToggle.setAttribute("aria-expanded", String(!foldersCollapsed));
  foldersActive.textContent = folderLabel(activeFolder);
  folderList.hidden = foldersCollapsed;
  dropTarget = null;
  folderList.replaceChildren(
    createFolderButton({ kind: "outside_project" }, counts.outsideProject),
    createFolderButton({ kind: "all" }, counts.all),
  );

  // Projetos conhecidos na ordem recebida (alfabética); Projetos referenciados
  // por conversas mas ausentes da lista vêm depois, sem aceitar soltura.
  const projectIds = [
    ...projects.map((project) => project.id),
    ...[...counts.byProject.keys()].filter((id) => !projectNames.has(id)),
  ];
  if (projectIds.length > 0) {
    const separator = document.createElement("div");
    separator.className = "folder-separator";
    folderList.append(separator);
  }
  for (const projectId of projectIds) {
    folderList.append(
      createFolderButton({ kind: "project", projectId }, counts.byProject.get(projectId) ?? 0),
    );
  }
}

function createFolderButton(folder: ConversationFolder, count: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isActiveFolder(folder) ? "folder active" : "folder";
  button.setAttribute("aria-pressed", String(isActiveFolder(folder)));

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folderLabel(folder);
  const countElement = document.createElement("span");
  countElement.className = "folder-count";
  countElement.textContent = String(count);
  button.append(name, countElement);
  button.addEventListener("click", () => setActiveFolder(folder));

  if (folder.kind === "project" && projectNames.has(folder.projectId)) {
    const projectId = folder.projectId;
    button.dataset.projectId = projectId;
    button.dataset.count = String(count);
    button.addEventListener("dragover", (event) => {
      if (draggedIds === null || busy) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "move";
      }
      setDropTarget(button);
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const ids = draggedIds;
      endDrag();
      if (ids !== null && ids.length > 0) {
        void runMove(ids, projectId);
      }
    });
  }

  return button;
}

function renderList(): void {
  // Recriar as linhas durante um arraste removeria o elemento de origem e o
  // `dragend` nunca chegaria; a renderização fica para o fim do arraste.
  if (draggedIds !== null) {
    renderDeferred = true;
    return;
  }

  const rows = visibleRows();
  conversationList.replaceChildren();

  if (rows.length === 0) {
    conversationList.append(createEmptyState(emptyListMessage()));
    return;
  }

  for (const row of rows) {
    conversationList.append(createRow(row));
  }
}

function emptyListMessage(): string {
  if (inventory.length === 0) {
    return "Nenhuma conversa encontrada.";
  }
  if (searchMode === "content" && contentSearch !== null) {
    return "Nenhum resultado da pesquisa nesta pasta.";
  }
  if (searchMode === "title" && searchQuery.value.trim().length > 0) {
    return "Nenhum título corresponde ao filtro nesta pasta.";
  }
  return "Esta pasta está vazia.";
}

function createRow(row: VisibleRow): HTMLDivElement {
  return row.kind === "missing"
    ? createMissingRow(row.hit)
    : createConversationRow(row.conversation, row.snippet);
}

function createMissingRow(hit: ConversationSearchHit): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "conversation conversation-missing";

  const placeholder = document.createElement("span");
  placeholder.className = "checkbox-placeholder";
  const content = document.createElement("span");
  content.className = "conversation-content";
  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = hit.title;
  const meta = document.createElement("span");
  meta.className = "conversation-meta";
  meta.textContent = "Fora da listagem local · atualize para organizar";
  content.append(title, meta);
  if (hit.snippet.length > 0) {
    content.append(createSnippet(hit.snippet));
  }

  element.append(placeholder, content);
  return element;
}

function createConversationRow(
  conversation: Conversation,
  snippet: string | null,
): HTMLDivElement {
  const id = conversation.id;
  const selectable = conversation.projectId === null;
  const pending = isPending(id);
  const element = document.createElement("div");
  element.className = "conversation";
  element.classList.toggle("conversation-in-project", !selectable);
  element.classList.toggle("conversation-pending", pending);
  element.classList.toggle("selected", selectedIds.has(id));
  element.dataset.conversationId = id;
  element.setAttribute("aria-busy", String(pending));

  if (selectable) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(id);
    checkbox.disabled = pending;
    checkbox.setAttribute("aria-label", `Selecionar: ${conversation.title}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      handleSelectionClick(id, event.shiftKey, checkbox.checked, element);
    });
    element.append(checkbox);

    // A linha inteira funciona como área de seleção, exceto botões e detalhes.
    element.addEventListener("click", (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("button, input, .conversation-details") !== null
      ) {
        return;
      }
      handleSelectionClick(id, event.shiftKey, !selectedIds.has(id), element);
    });

    element.draggable = !busy;
    element.addEventListener("dragstart", (event) => startDrag(event, id));
    element.addEventListener("dragend", endDrag);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "checkbox-placeholder";
    element.append(placeholder);
  }

  const content = document.createElement("span");
  content.className = "conversation-content";
  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = conversation.title;
  const meta = document.createElement("span");
  meta.className = "conversation-meta";
  const location = selectable
    ? "Sem projeto"
    : (projectNames.get(conversation.projectId ?? "") ?? "Projeto não listado");
  const metaParts = [location];
  if (conversation.updatedAt !== null) {
    metaParts.push(formatDate(conversation.updatedAt));
  }
  if (pending) {
    metaParts.unshift(pendingOperation?.kind === "delete" ? "Excluindo…" : "Movendo…");
  }
  meta.textContent = metaParts.join(" · ");
  content.append(title, meta);
  if (snippet !== null && snippet.length > 0) {
    content.append(createSnippet(snippet));
  }
  element.append(content);

  const expanded = expandedIds.has(id);
  const expandButton = document.createElement("button");
  expandButton.type = "button";
  expandButton.className = "icon-button expand-button";
  expandButton.setAttribute("aria-expanded", String(expanded));
  expandButton.setAttribute("aria-label", `Mostrar contexto: ${conversation.title}`);
  expandButton.title = expanded ? "Ocultar contexto" : "Mostrar contexto";
  expandButton.append(createIcon("M6 9l6 6 6-6"));
  expandButton.addEventListener("click", () => toggleExpanded(id));
  element.append(expandButton);

  if (selectable) {
    const deleteRowButton = document.createElement("button");
    deleteRowButton.type = "button";
    deleteRowButton.className = "icon-button";
    deleteRowButton.append(createIcon("M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"));
    deleteRowButton.setAttribute("aria-label", `Excluir conversa: ${conversation.title}`);
    deleteRowButton.title = "Excluir conversa";
    deleteRowButton.disabled = busy;
    deleteRowButton.addEventListener("click", () => void deleteConversations([id]));
    element.append(deleteRowButton);
  }

  if (expanded) {
    element.append(createDetails(conversation));
  }

  return element;
}

function createSnippet(text: string): HTMLSpanElement {
  const snippet = document.createElement("span");
  snippet.className = "conversation-preview";
  snippet.textContent = text;
  return snippet;
}

function createDetails(conversation: Conversation): HTMLDivElement {
  const details = document.createElement("div");
  details.className = "conversation-details";
  const state = contextStates.get(conversation.id);

  if (state === undefined || state.status === "loading") {
    details.append("Carregando contexto…");
  } else if (state.status === "error") {
    details.append(state.message);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "text-button";
    retry.textContent = "Tentar novamente";
    retry.addEventListener("click", () => void loadContext(conversation.id));
    details.append(retry);
  } else {
    details.append(
      createContextBlock("Você", state.context.firstUserMessage, "Sem mensagem de texto."),
      createContextBlock(
        "ChatGPT · última resposta",
        state.context.lastAssistantMessage,
        "Sem resposta de texto.",
      ),
    );
  }

  const footer = document.createElement("div");
  footer.className = "context-footer";
  const dates: string[] = [];
  if (conversation.createdAt !== null) {
    dates.push(`Criada ${formatDate(conversation.createdAt)}`);
  }
  if (conversation.updatedAt !== null) {
    dates.push(`Atualizada ${formatDate(conversation.updatedAt)}`);
  }
  const dateText = document.createElement("span");
  dateText.textContent = dates.join(" · ");
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "text-button";
  openButton.textContent = "Abrir ↗";
  openButton.title = "Abrir conversa na aba ativa";
  openButton.addEventListener("click", () => void openConversation(conversation.id));
  footer.append(dateText, openButton);
  details.append(footer);

  return details;
}

function createContextBlock(label: string, text: string, fallback: string): HTMLDivElement {
  const block = document.createElement("div");
  const labelElement = document.createElement("span");
  labelElement.className = "context-label";
  labelElement.textContent = label;
  const textElement = document.createElement("span");
  textElement.className = "context-text";
  textElement.textContent = text.length > 0 ? text : fallback;
  block.append(labelElement, textElement);
  return block;
}

function createIcon(pathData: string): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

// Substitui somente a linha afetada, preservando rolagem e foco do restante.
function replaceRow(conversationId: string): void {
  if (draggedIds !== null) {
    renderDeferred = true;
    return;
  }
  const element = conversationList.querySelector(
    `[data-conversation-id="${CSS.escape(conversationId)}"]`,
  );
  const row = visibleRows().find(
    (candidate) =>
      candidate.kind === "conversation" && candidate.conversation.id === conversationId,
  );
  if (element !== null && row !== undefined) {
    element.replaceWith(createRow(row));
  }
}

// --- Contexto ---------------------------------------------------------------------

function toggleExpanded(conversationId: string): void {
  if (expandedIds.has(conversationId)) {
    expandedIds.delete(conversationId);
    replaceRow(conversationId);
    return;
  }

  expandedIds.add(conversationId);
  const state = contextStates.get(conversationId);
  if (state === undefined || state.status === "error") {
    void loadContext(conversationId);
  } else {
    replaceRow(conversationId);
  }
}

// Uma chamada por conversa por sessão do painel; o detalhe passa pela mesma fila
// serial e pelo tratamento de rate limit das demais chamadas.
async function loadContext(conversationId: string): Promise<void> {
  contextStates.set(conversationId, { status: "loading" });
  replaceRow(conversationId);

  try {
    const context = await sendMessage<ConversationContext>({
      type: "get-conversation-context",
      conversationId,
    });
    contextStates.set(conversationId, { status: "loaded", context });
  } catch (error) {
    contextStates.set(conversationId, { status: "error", message: errorMessage(error) });
  }
  replaceRow(conversationId);
}

async function openConversation(conversationId: string): Promise<void> {
  try {
    await sendMessage<{ opened: true }>({ type: "open-conversation", conversationId });
  } catch (error) {
    showNotice(errorMessage(error), true);
  }
}

// --- Seleção ------------------------------------------------------------------------

function handleSelectionClick(
  conversationId: string,
  withShift: boolean,
  checked: boolean,
  element: HTMLDivElement,
): void {
  if (isPending(conversationId)) {
    return;
  }

  if (withShift && selectionAnchorId !== null) {
    const orderedIds = visibleConversations().map((conversation) => conversation.id);
    const selectable = new Set([...selectableIds()].filter((id) => !isPending(id)));
    const range = selectRange(orderedIds, selectionAnchorId, conversationId, selectable);
    for (const id of range) {
      if (checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
    }
    selectionAnchorId = conversationId;
    renderList();
    updateControls();
    return;
  }

  if (checked) {
    selectedIds.add(conversationId);
  } else {
    selectedIds.delete(conversationId);
  }
  selectionAnchorId = conversationId;
  element.classList.toggle("selected", checked);
  const checkbox = element.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (checkbox !== null) {
    checkbox.checked = checked;
  }
  updateControls();
}

function toggleVisibleSelection(): void {
  const selectableVisible = visibleConversations()
    .filter((conversation) => conversation.projectId === null && !isPending(conversation.id))
    .map((conversation) => conversation.id);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((id) => selectedIds.has(id));

  for (const id of selectableVisible) {
    if (allVisibleSelected) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
  }

  renderList();
  updateControls();
}

function clearSelection(): void {
  // Itens em operação continuam selecionados até a resposta chegar.
  selectedIds = new Set([...selectedIds].filter((id) => isPending(id)));
  selectionAnchorId = null;
  closeMoveMenu();
  renderList();
  updateControls();
}

function isPending(conversationId: string): boolean {
  return pendingOperation?.ids.has(conversationId) ?? false;
}

// --- Arrastar e soltar ------------------------------------------------------------

function startDrag(event: DragEvent, conversationId: string): void {
  if (busy || event.dataTransfer === null) {
    event.preventDefault();
    return;
  }

  draggedIds = dragSet(conversationId, selectedIds);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `${draggedIds.length} conversa(s)`);

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = `Mover ${draggedIds.length} conversa(s)`;
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  // A imagem é capturada de forma síncrona; o elemento pode sair logo em seguida.
  window.setTimeout(() => ghost.remove(), 0);

  document.body.classList.add("dragging");
  closeMoveMenu();
  if (foldersCollapsed) {
    foldersCollapsed = false;
    renderFolders();
  }
}

function endDrag(): void {
  if (draggedIds === null) {
    return;
  }
  draggedIds = null;
  clearDropTarget();
  document.body.classList.remove("dragging");
  if (renderDeferred) {
    renderDeferred = false;
    renderList();
  }
}

function setDropTarget(button: HTMLButtonElement): void {
  if (dropTarget === button || draggedIds === null) {
    return;
  }
  clearDropTarget();
  dropTarget = button;
  button.classList.add("drop-target");
  const count = button.querySelector(".folder-count");
  if (count !== null) {
    count.textContent = `Mover ${draggedIds.length} aqui`;
  }
}

function clearDropTarget(): void {
  if (dropTarget === null) {
    return;
  }
  dropTarget.classList.remove("drop-target");
  const count = dropTarget.querySelector(".folder-count");
  if (count !== null) {
    count.textContent = dropTarget.dataset.count ?? "";
  }
  dropTarget = null;
}

// --- Mover para… ------------------------------------------------------------------

function toggleMoveMenu(): void {
  if (!moveMenu.hidden) {
    closeMoveMenu();
    return;
  }
  moveMenu.hidden = false;
  moveOpenButton.setAttribute("aria-expanded", "true");
  moveFilter.value = "";
  renderMoveOptions();
  moveFilter.focus();
}

function closeMoveMenu(): void {
  moveMenu.hidden = true;
  moveOpenButton.setAttribute("aria-expanded", "false");
}

function renderMoveOptions(): void {
  const query = moveFilter.value.trim().toLocaleLowerCase("pt-BR");
  const matches = projects.filter((project) =>
    project.name.toLocaleLowerCase("pt-BR").includes(query),
  );
  moveOptions.replaceChildren();

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "move-empty";
    empty.textContent = projects.length === 0 ? "Nenhum Projeto encontrado." : "Nenhum Projeto corresponde.";
    moveOptions.append(empty);
    return;
  }

  for (const project of matches) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "move-option";
    option.setAttribute("role", "option");
    option.textContent = project.name;
    option.addEventListener("click", () => {
      closeMoveMenu();
      void runMove([...selectedIds], project.id);
    });
    moveOptions.append(option);
  }
}

// --- Operações ----------------------------------------------------------------------

async function runMove(conversationIds: string[], destinationProjectId: string): Promise<void> {
  if (conversationIds.length === 0 || destinationProjectId.length === 0 || busy) {
    return;
  }

  pendingOperation = { kind: "move", ids: new Set(conversationIds) };
  setBusy(true, `Movendo ${conversationIds.length} conversa(s)…`);
  hideNotice();

  try {
    const result = await sendMessage<MoveBatchResult>({
      type: "move",
      conversationIds,
      destinationProjectId,
    });
    applyMoveResult(result);
  } catch (error) {
    showNotice(errorMessage(error), true);
  } finally {
    pendingOperation = null;
    setBusy(false);
    await refreshDebugSafely();
  }
}

function applyMoveResult(result: MoveBatchResult): void {
  const projectByConversation = new Map<string, string>();
  for (const item of result.items) {
    if (item.status === "success") {
      projectByConversation.set(item.conversationId, result.destinationProjectId);
    } else if (item.status === "skipped") {
      projectByConversation.set(item.conversationId, item.projectId);
    }
  }
  const successCount = result.items.filter((item) => item.status === "success").length;
  const skippedCount = result.items.filter((item) => item.status === "skipped").length;
  const failedIds = result.items
    .filter((item) => item.status === "failure")
    .map((item) => item.conversationId);

  inventory = inventory.map((conversation) => {
    const projectId = projectByConversation.get(conversation.id);
    return projectId === undefined ? conversation : { ...conversation, projectId };
  });
  // Itens que falharam permanecem selecionados; a retentativa age exatamente
  // sobre eles, nunca sobre a seleção inteira.
  selectedIds = new Set([...selectedIds].filter((id) => !projectByConversation.has(id)));
  renderAll();

  const destination = projectNames.get(result.destinationProjectId) ?? "o Projeto";
  const parts = [`${successCount} movida(s) para «${destination}»`];
  if (skippedCount > 0) {
    parts.push(`${skippedCount} ignorada(s) por já estar(em) em Projeto`);
  }
  if (failedIds.length > 0) {
    parts.push(`${failedIds.length} falha(s)`);
  }
  showNotice(`${parts.join(" · ")}.`, failedIds.length > 0, retryAction(failedIds, () => {
    void runMove(failedIds, result.destinationProjectId);
  }));
}

async function deleteConversations(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0 || busy) {
    return;
  }

  const confirmed = window.confirm(
    `Excluir ${conversationIds.length} conversa(s)? A exclusão usa o mecanismo do próprio ChatGPT e pode ser permanente.`,
  );
  if (!confirmed) {
    return;
  }

  pendingOperation = { kind: "delete", ids: new Set(conversationIds) };
  setBusy(true, `Excluindo ${conversationIds.length} conversa(s)…`);
  hideNotice();

  try {
    const result = await sendMessage<DeleteBatchResult>({ type: "delete", conversationIds });
    applyDeleteResult(result);
  } catch (error) {
    showNotice(errorMessage(error), true);
  } finally {
    pendingOperation = null;
    setBusy(false);
    await refreshDebugSafely();
  }
}

function applyDeleteResult(result: DeleteBatchResult): void {
  const deletedIds = new Set(
    result.items.filter((item) => item.status === "success").map((item) => item.conversationId),
  );
  const skippedProjects = new Map(
    result.items
      .filter((item) => item.status === "skipped")
      .map((item) => [item.conversationId, item.projectId] as const),
  );
  const failedIds = result.items
    .filter((item) => item.status === "failure")
    .map((item) => item.conversationId);

  inventory = inventory
    .filter((conversation) => !deletedIds.has(conversation.id))
    .map((conversation) => {
      const projectId = skippedProjects.get(conversation.id);
      return projectId === undefined ? conversation : { ...conversation, projectId };
    });
  selectedIds = new Set(
    [...selectedIds].filter((id) => !deletedIds.has(id) && !skippedProjects.has(id)),
  );
  for (const id of deletedIds) {
    expandedIds.delete(id);
    contextStates.delete(id);
  }

  searchCache.removeConversations(deletedIds);
  recordCacheEvent("items_removed", { count: deletedIds.size });
  if (contentSearch !== null) {
    contentSearch = {
      ...contentSearch,
      hits: contentSearch.hits.filter((hit) => !deletedIds.has(hit.id)),
    };
  }
  renderAll();

  const parts = [`${deletedIds.size} excluída(s)`];
  if (skippedProjects.size > 0) {
    parts.push(`${skippedProjects.size} ignorada(s) por estar(em) em Projeto`);
  }
  if (failedIds.length > 0) {
    parts.push(`${failedIds.length} falha(s)`);
  }
  // A retentativa passa pelo mesmo fluxo, então a confirmação continua exigida.
  showNotice(`${parts.join(" · ")}.`, failedIds.length > 0, retryAction(failedIds, () => {
    void deleteConversations(failedIds);
  }));
}

function retryAction(failedIds: string[], run: () => void): NoticeAction | undefined {
  return failedIds.length === 0
    ? undefined
    : { label: `Tentar novamente (${failedIds.length})`, run };
}

// --- Controles -----------------------------------------------------------------------

function updateControls(): void {
  if (!inventoryLoaded) {
    return;
  }

  const visible = visibleConversations();
  const visibleIds = new Set(visible.map((conversation) => conversation.id));
  const selectableVisible = visible.filter((conversation) => conversation.projectId === null);
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((conversation) => selectedIds.has(conversation.id));

  listSummary.textContent = `${visible.length} nesta visão · ${inventory.length} no total`;
  freshness.textContent = fetchedAt !== null ? `Sincronizado ${formatAge(fetchedAt)}` : "";
  selectVisibleButton.textContent = allVisibleSelected
    ? "Desmarcar visíveis"
    : "Selecionar visíveis";
  selectVisibleButton.disabled = busy || selectableVisible.length === 0;
  searchSubmit.disabled = busy;
  updateSearchNote(visible.length);

  const hiddenSelected = [...selectedIds].filter((id) => !visibleIds.has(id)).length;
  actionBar.classList.toggle("visible", selectedIds.size > 0);
  selectionSummary.textContent =
    hiddenSelected > 0
      ? `${selectedIds.size} selecionada(s) · ${hiddenSelected} fora desta visão`
      : `${selectedIds.size} selecionada(s)`;
  moveOpenButton.disabled = busy || projects.length === 0;
  deleteButton.disabled = busy || selectedIds.size === 0;
  deleteButton.textContent = selectedIds.size > 0 ? `Excluir (${selectedIds.size})` : "Excluir";
  clearButton.disabled = busy;

  if (selectedIds.size === 0 || busy) {
    closeMoveMenu();
  }
}

function updateSearchNote(visibleCount: number): void {
  if (searchMode === "title") {
    searchNote.hidden = true;
    return;
  }

  searchNote.hidden = false;
  if (contentSearch === null) {
    searchNote.textContent = "Pressione Enter para pesquisar no conteúdo das conversas.";
    return;
  }

  const parts = [
    `${contentSearch.hits.length} resultado(s) para «${contentSearch.query}»`,
    `${visibleCount} nesta pasta`,
  ];
  const missing = missingHitCount();
  if (missing > 0) {
    parts.push(`${missing} fora da listagem local (aparecem em Todas; atualize para organizar)`);
  }
  searchNote.textContent = parts.join(" · ");
}

function setBusy(value: boolean, label?: string): void {
  busy = value;
  setConnection(value ? (label ?? "Processando…") : "Pronto");
  // Fora de updateControls: o botão existe antes da primeira carga.
  syncButton.disabled = value;
  // Linhas refletem o travamento (itens em operação, arraste e exclusão por linha).
  if (inventoryLoaded) {
    renderList();
  }
  syncButton.title =
    fetchedAt !== null
      ? `Buscar novamente todas as conversas e Projetos no ChatGPT · sincronizado ${formatAge(fetchedAt)}`
      : "Buscar todas as conversas e Projetos no ChatGPT";
  updateControls();
}

function formatAge(iso: string): string {
  const elapsedMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "agora";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return "agora";
  }
  if (minutes < 60) {
    return `há ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `há ${hours} h`;
  }
  return `há ${Math.floor(hours / 24)} d`;
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleDateString("pt-BR");
}

// --- Debug -----------------------------------------------------------------------------

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
  const visibleEvents = state.events.slice(-200);
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
  // A rolagem pertence à aba de debug; os eventos mais recentes ficam visíveis.
  viewDebug.scrollTop = viewDebug.scrollHeight;
}

// --- Infraestrutura do painel ------------------------------------------------------------

function isProgressEvent(message: unknown): message is ExtensionEvent {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "operation-progress"
  );
}

function progressLabel(event: ExtensionEvent): string {
  if (event.phase === "waiting") {
    return "Aguardando o limite do ChatGPT…";
  }

  const verb =
    event.operation === "move"
      ? "Movendo"
      : event.operation === "delete"
        ? "Excluindo"
        : "Carregando";

  // Total zero significa total ainda desconhecido (paginação em andamento).
  if (event.total === 0) {
    return `${verb} conversas… (${event.done})`;
  }

  const suffix = event.title === null ? "" : ` · ${truncate(event.title, 32)}`;
  return `${verb} ${event.done} de ${event.total}…${suffix}`;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function setConnection(text: string): void {
  const dot = connectionStatus.querySelector(".status-dot");
  connectionStatus.replaceChildren();
  if (dot !== null) {
    connectionStatus.append(dot);
  }
  connectionStatus.append(text);
}

interface NoticeAction {
  label: string;
  run: () => void;
}

function showNotice(message: string, isError: boolean, action?: NoticeAction): void {
  notice.replaceChildren(message);
  if (action !== undefined) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notice-action";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    notice.append(button);
  }
  notice.className = isError ? "notice visible error" : "notice visible";
}

function hideNotice(): void {
  notice.replaceChildren();
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
