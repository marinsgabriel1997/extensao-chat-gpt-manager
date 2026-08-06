import {
  filterByScope,
  type Conversation,
  type ConversationScopeFilter,
  type DeleteBatchResult,
  type MoveBatchResult,
  type Project,
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

const searchForm = requiredElement<HTMLFormElement>("search-form");
const searchQuery = requiredElement<HTMLInputElement>("search-query");
const searchButton = requiredElement<HTMLButtonElement>("search-button");
const conversationList = requiredElement<HTMLDivElement>("conversation-list");
const selectionCount = requiredElement<HTMLParagraphElement>("selection-count");
const selectAllButton = requiredElement<HTMLButtonElement>("select-all-button");
const resultSummary = requiredElement<HTMLParagraphElement>("result-summary");
const projectSelect = requiredElement<HTMLSelectElement>("project-select");
const projectsLoadButton = requiredElement<HTMLButtonElement>("projects-load-button");
const projectsRefreshButton = requiredElement<HTMLButtonElement>("projects-refresh-button");
const moveSummary = requiredElement<HTMLParagraphElement>("move-summary");
const moveButton = requiredElement<HTMLButtonElement>("move-button");
const notice = requiredElement<HTMLDivElement>("notice");
const debugToggle = requiredElement<HTMLButtonElement>("debug-toggle");
const debugOutput = requiredElement<HTMLDivElement>("debug-output");
const debugBadge = requiredElement<HTMLElement>("debug-title").querySelector<HTMLElement>(
  ".badge",
);
const connectionStatus = requiredElement<HTMLElement>("connection-status");

const tabOrganizeButton = requiredElement<HTMLButtonElement>("tab-organize");
const tabAllButton = requiredElement<HTMLButtonElement>("tab-all");
const viewOrganize = requiredElement<HTMLDivElement>("view-organize");
const viewAll = requiredElement<HTMLDivElement>("view-all");
const allControls = requiredElement<HTMLDivElement>("all-controls");
const allFilterText = requiredElement<HTMLInputElement>("all-filter-text");
const chipOutside = requiredElement<HTMLButtonElement>("chip-outside");
const chipIn = requiredElement<HTMLButtonElement>("chip-in");
const chipAll = requiredElement<HTMLButtonElement>("chip-all");
const allSummary = requiredElement<HTMLParagraphElement>("all-summary");
const allFreshness = requiredElement<HTMLParagraphElement>("all-freshness");
const allSelectVisible = requiredElement<HTMLButtonElement>("all-select-visible");
const allList = requiredElement<HTMLDivElement>("all-list");
const allActions = requiredElement<HTMLDivElement>("all-actions");
const allSelectionSummary = requiredElement<HTMLSpanElement>("all-selection-summary");
const allClearButton = requiredElement<HTMLButtonElement>("all-clear-button");
const allDeleteButton = requiredElement<HTMLButtonElement>("all-delete-button");
const allRefreshButton = requiredElement<HTMLButtonElement>("all-refresh-button");

let conversations: Conversation[] = [];
let filteredCount = 0;
let selectedIds = new Set<string>();
let projects: Project[] = [];
let projectsLoaded = false;
let busy = false;
const searchCache = new SearchSessionCache();

let inventory: Conversation[] = [];
let inventoryProjects = new Map<string, string>();
let inventoryFetchedAt: string | null = null;
let inventoryLoaded = false;
let inventoryCacheChecked = false;
let allSelectedIds = new Set<string>();
let scopeFilter: ConversationScopeFilter = "outside_project";

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
projectsLoadButton.addEventListener("click", () => void loadProjectsManually());
moveButton.addEventListener("click", () => void moveSelected());
debugToggle.addEventListener("click", () => void toggleDebug());

tabOrganizeButton.addEventListener("click", () => setActiveTab("organize"));
tabAllButton.addEventListener("click", () => setActiveTab("all"));
allFilterText.addEventListener("input", () => renderInventory());
chipOutside.addEventListener("click", () => setScopeFilter("outside_project"));
chipIn.addEventListener("click", () => setScopeFilter("in_project"));
chipAll.addEventListener("click", () => setScopeFilter("all"));
allSelectVisible.addEventListener("click", toggleVisibleSelection);
allClearButton.addEventListener("click", () => {
  allSelectedIds.clear();
  renderInventory();
});
allDeleteButton.addEventListener("click", () => void deleteConversations([...allSelectedIds]));
allRefreshButton.addEventListener("click", () => void loadInventory());
projectsRefreshButton.addEventListener("click", () => void loadProjectsManually());

// Progresso das operações longas. A guarda por `busy` evita que um evento
// atrasado sobrescreva o estado "Pronto" depois do fim da operação.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (busy && isProgressEvent(message)) {
    setConnection(progressLabel(message));
  }
});

void initialize();

// A abertura do painel não dispara nenhuma chamada ao ChatGPT: Projetos e
// conversas são carregados somente pelos botões dedicados de cada aba.
async function initialize(): Promise<void> {
  updateActions();
  try {
    await refreshDebug();
  } catch (error) {
    setConnection("Atenção");
    showNotice(errorMessage(error), true);
  }
}

async function loadProjectsManually(): Promise<void> {
  if (busy) {
    return;
  }

  setBusy(true, "Carregando Projetos…");
  hideNotice();
  try {
    await loadProjects();
    setConnection("Pronto");
  } catch (error) {
    setConnection("Atenção");
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
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
  // Caminho leve: somente os nomes dos Projetos. O índice completo de
  // conversas por Projeto é construído sob demanda pela primeira pesquisa.
  projects = await sendMessage<Project[]>({ type: "list-project-names" });
  projectsLoaded = true;
  // O botão grande de carregar dá lugar ao select; atualizar vira ação discreta.
  projectsLoadButton.hidden = true;
  projectSelect.hidden = false;
  projectsRefreshButton.hidden = false;
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
  await runMove([...selectedIds], projectSelect.value);
}

async function runMove(
  conversationIds: string[],
  destinationProjectId: string,
): Promise<void> {
  if (conversationIds.length === 0 || destinationProjectId.length === 0 || busy) {
    return;
  }

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
  const failedIds = result.items
    .filter((item) => item.status === "failure")
    .map((item) => item.conversationId);
  const failedCount = failedIds.length;

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
  // Itens que falharam permanecem selecionados; a retentativa age exatamente
  // sobre eles, nunca sobre a seleção inteira.
  showNotice(`${parts.join(" · ")}.`, failedCount > 0, retryAction(failedIds, () => {
    void runMove(failedIds, result.destinationProjectId);
  }));

  syncInventoryAfterMove(result);
}

function syncInventoryAfterMove(result: MoveBatchResult): void {
  if (!inventoryLoaded) {
    return;
  }

  const projectByConversation = new Map<string, string>();
  for (const item of result.items) {
    if (item.status === "success") {
      projectByConversation.set(item.conversationId, result.destinationProjectId);
    } else if (item.status === "skipped") {
      projectByConversation.set(item.conversationId, item.projectId);
    }
  }

  if (projectByConversation.size === 0) {
    return;
  }

  inventory = inventory.map((conversation) => {
    const projectId = projectByConversation.get(conversation.id);
    return projectId === undefined ? conversation : { ...conversation, projectId };
  });
  allSelectedIds = new Set(
    [...allSelectedIds].filter((id) => !projectByConversation.has(id)),
  );
  renderInventory();
}

function setActiveTab(tab: "organize" | "all"): void {
  const isAll = tab === "all";
  viewOrganize.hidden = isAll;
  viewAll.hidden = !isAll;
  tabOrganizeButton.classList.toggle("active", !isAll);
  tabAllButton.classList.toggle("active", isAll);
  tabOrganizeButton.setAttribute("aria-selected", String(!isAll));
  tabAllButton.setAttribute("aria-selected", String(isAll));

  // Abrir a aba só lê o cache local; a busca no ChatGPT é sempre manual.
  if (isAll && !inventoryCacheChecked && !busy) {
    void loadCachedInventory();
  }
}

function setScopeFilter(filter: ConversationScopeFilter): void {
  scopeFilter = filter;
  chipOutside.classList.toggle("active", filter === "outside_project");
  chipIn.classList.toggle("active", filter === "in_project");
  chipAll.classList.toggle("active", filter === "all");
  renderInventory();
}

async function loadCachedInventory(): Promise<void> {
  inventoryCacheChecked = true;

  try {
    const result = await sendMessage<{ inventory: ConversationInventory | null }>({
      type: "get-cached-conversations",
    });
    if (result.inventory !== null) {
      applyInventory(result.inventory);
      return;
    }
    allList.replaceChildren(
      createLoadPrompt("Nenhum dado local disponível.", "Carregar conversas"),
    );
  } catch (error) {
    showNotice(errorMessage(error), true);
  }
}

// Empty state com a ação principal embutida: enquanto não há dados, o próprio
// espaço vazio da lista convida ao carregamento.
function createLoadPrompt(message: string, label: string): HTMLDivElement {
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
  return element;
}

async function loadInventory(): Promise<void> {
  if (busy) {
    return;
  }

  setBusy(true, "Carregando todas as conversas…");
  hideNotice();
  if (!inventoryLoaded) {
    allList.replaceChildren(createEmptyState("Carregando conversas do ChatGPT…"));
  }

  try {
    const result = await sendMessage<ConversationInventory>({
      type: "list-all-conversations",
      refresh: true,
    });
    applyInventory(result);
  } catch (error) {
    if (!inventoryLoaded) {
      allList.replaceChildren(
        createLoadPrompt("Não foi possível carregar as conversas.", "Tentar novamente"),
      );
    }
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

function applyInventory(result: ConversationInventory): void {
  inventory = result.conversations;
  inventoryProjects = new Map(result.projects.map((project) => [project.id, project.name]));
  inventoryFetchedAt = result.fetchedAt;
  inventoryLoaded = true;
  allControls.hidden = false;

  // Reconciliação preserva a seleção manual por interseção: somente ids que
  // permanecem existentes e fora de projeto continuam selecionados.
  const selectable = new Set(
    inventory
      .filter((conversation) => conversation.projectId === null)
      .map((conversation) => conversation.id),
  );
  const previousSize = allSelectedIds.size;
  allSelectedIds = new Set([...allSelectedIds].filter((id) => selectable.has(id)));
  const removed = previousSize - allSelectedIds.size;
  if (removed > 0) {
    showNotice(
      `${removed} conversa(s) saíram da seleção porque foram removidas ou entraram em Projetos.`,
      false,
    );
  }

  renderInventory();
}

function visibleInventory(): Conversation[] {
  const scoped = filterByScope(inventory, scopeFilter);
  const query = allFilterText.value.trim().toLocaleLowerCase("pt-BR");
  if (query.length === 0) {
    return scoped;
  }
  return scoped.filter((conversation) =>
    conversation.title.toLocaleLowerCase("pt-BR").includes(query),
  );
}

function renderInventory(): void {
  if (!inventoryLoaded) {
    updateAllControls([]);
    return;
  }

  const visible = visibleInventory();
  allList.replaceChildren();

  if (visible.length === 0) {
    allList.append(
      createEmptyState(
        inventory.length === 0
          ? "Nenhuma conversa encontrada."
          : "Nenhuma conversa corresponde aos filtros atuais.",
      ),
    );
  } else {
    for (const conversation of visible) {
      allList.append(createInventoryRow(conversation));
    }
  }

  updateAllControls(visible);
}

function createInventoryRow(conversation: Conversation): HTMLDivElement {
  const row = document.createElement("div");
  const inProject = conversation.projectId !== null;
  row.className = inProject
    ? "conversation conversation-compact conversation-in-project"
    : allSelectedIds.has(conversation.id)
      ? "conversation conversation-compact selected"
      : "conversation conversation-compact";

  if (inProject) {
    const placeholder = document.createElement("span");
    placeholder.className = "checkbox-placeholder";
    row.append(placeholder);
  } else {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = allSelectedIds.has(conversation.id);
    checkbox.setAttribute("aria-label", `Selecionar: ${conversation.title}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        allSelectedIds.add(conversation.id);
      } else {
        allSelectedIds.delete(conversation.id);
      }
      row.classList.toggle("selected", checkbox.checked);
      updateAllControls(visibleInventory());
    });
    row.append(checkbox);
  }

  const content = document.createElement("span");
  content.className = "conversation-content";
  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = conversation.title;
  const meta = document.createElement("span");
  meta.className = "conversation-meta";
  const location = inProject
    ? (inventoryProjects.get(conversation.projectId ?? "") ?? "Projeto")
    : "Sem projeto";
  meta.textContent =
    conversation.updatedAt === null
      ? location
      : `${location} · ${formatDate(conversation.updatedAt)}`;
  content.append(title, meta);
  row.append(content);

  if (!inProject) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "icon-button";
    deleteButton.type = "button";
    deleteButton.textContent = "🗑";
    deleteButton.setAttribute("aria-label", `Excluir conversa: ${conversation.title}`);
    deleteButton.title = "Excluir conversa";
    deleteButton.addEventListener("click", () => void deleteConversations([conversation.id]));
    row.append(deleteButton);
  }

  return row;
}

function toggleVisibleSelection(): void {
  const selectableVisible = visibleInventory()
    .filter((conversation) => conversation.projectId === null)
    .map((conversation) => conversation.id);
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((id) => allSelectedIds.has(id));

  if (allVisibleSelected) {
    for (const id of selectableVisible) {
      allSelectedIds.delete(id);
    }
  } else {
    for (const id of selectableVisible) {
      allSelectedIds.add(id);
    }
  }

  renderInventory();
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

  setBusy(true, `Excluindo ${conversationIds.length} conversa(s)…`);
  hideNotice();

  try {
    const result = await sendMessage<DeleteBatchResult>({
      type: "delete",
      conversationIds,
    });
    applyDeleteResult(result);
  } catch (error) {
    showNotice(errorMessage(error), true);
  } finally {
    setBusy(false);
    await refreshDebugSafely();
  }
}

function applyDeleteResult(result: DeleteBatchResult): void {
  const deletedIds = new Set(
    result.items
      .filter((item) => item.status === "success")
      .map((item) => item.conversationId),
  );
  const skippedProjects = new Map(
    result.items
      .filter((item) => item.status === "skipped")
      .map((item) => [item.conversationId, item.projectId] as const),
  );
  const successCount = deletedIds.size;
  const skippedCount = skippedProjects.size;
  const failedIds = result.items
    .filter((item) => item.status === "failure")
    .map((item) => item.conversationId);
  const failedCount = failedIds.length;

  inventory = inventory
    .filter((conversation) => !deletedIds.has(conversation.id))
    .map((conversation) => {
      const projectId = skippedProjects.get(conversation.id);
      return projectId === undefined ? conversation : { ...conversation, projectId };
    });
  allSelectedIds = new Set(
    [...allSelectedIds].filter(
      (id) => !deletedIds.has(id) && !skippedProjects.has(id),
    ),
  );

  // Conversas excluídas também deixam de existir para a aba de organização.
  searchCache.removeConversations(deletedIds);
  recordCacheEvent("items_removed", { count: deletedIds.size });
  conversations = conversations.filter((conversation) => !deletedIds.has(conversation.id));
  selectedIds = new Set([...selectedIds].filter((id) => !deletedIds.has(id)));

  renderConversations();
  updateActions();
  renderInventory();

  const parts = [`${successCount} excluída(s)`];
  if (skippedCount > 0) {
    parts.push(`${skippedCount} ignorada(s) por estar(em) em Projeto`);
  }
  if (failedCount > 0) {
    parts.push(`${failedCount} falha(s)`);
  }
  // A retentativa passa pelo mesmo fluxo, então a confirmação da exclusão
  // continua sendo exigida.
  showNotice(`${parts.join(" · ")}.`, failedCount > 0, retryAction(failedIds, () => {
    void deleteConversations(failedIds);
  }));
}

function retryAction(failedIds: string[], run: () => void): NoticeAction | undefined {
  return failedIds.length === 0
    ? undefined
    : { label: `Tentar novamente (${failedIds.length})`, run };
}

function updateAllControls(visible: Conversation[]): void {
  const selectableVisible = visible.filter(
    (conversation) => conversation.projectId === null,
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((conversation) => allSelectedIds.has(conversation.id));

  allSummary.textContent = inventoryLoaded
    ? `${inventory.length} conversa(s) · ${visible.length} visível(is) · ${allSelectedIds.size} selecionada(s)`
    : "Nenhuma conversa carregada";
  allFreshness.textContent =
    inventoryFetchedAt !== null ? `Atualizado ${formatAge(inventoryFetchedAt)}` : "";
  allSelectVisible.textContent = allVisibleSelected
    ? "Desmarcar visíveis"
    : "Selecionar visíveis";
  allSelectVisible.disabled = busy || selectableVisible.length === 0;
  allFilterText.disabled = busy || !inventoryLoaded;
  allRefreshButton.disabled = busy;

  allActions.classList.toggle("visible", allSelectedIds.size > 0);
  allSelectionSummary.textContent = `${allSelectedIds.size} conversa(s) fora de projeto`;
  allClearButton.disabled = busy;
  allDeleteButton.disabled = busy || allSelectedIds.size === 0;
  allDeleteButton.textContent =
    allSelectedIds.size > 0 ? `Excluir (${allSelectedIds.size})` : "Excluir";
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
  projectsLoadButton.disabled = busy;
  projectsRefreshButton.disabled = busy;
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
  updateAllControls(inventoryLoaded ? visibleInventory() : []);
}

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

