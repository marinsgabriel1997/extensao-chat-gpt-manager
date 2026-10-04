export type ConversationId = string;
export type ProjectId = string;

export interface Conversation {
  id: ConversationId;
  title: string;
  preview: string;
  projectId: ProjectId | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// Pasta da tela de organização. "Pasta" é o vocabulário da interface; um
// Projeto do ChatGPT é uma das pastas possíveis.
export type ConversationFolder =
  | { kind: "outside_project" }
  | { kind: "all" }
  | { kind: "project"; projectId: ProjectId };

export interface FolderCounts {
  outsideProject: number;
  all: number;
  // Inclui Projetos sem conversas (contagem zero) e Projetos referenciados por
  // conversas mas ausentes da lista de Projetos.
  byProject: Map<ProjectId, number>;
}

// Resultado da pesquisa por conteúdo. O vínculo com Projeto não vem da pesquisa:
// é resolvido pelo identificador contra a listagem completa.
export interface ConversationSearchHit {
  id: ConversationId;
  title: string;
  snippet: string;
  updatedAt: string | null;
}

export interface ConversationContext {
  conversationId: ConversationId;
  firstUserMessage: string;
  lastAssistantMessage: string;
}

export interface Project {
  id: ProjectId;
  name: string;
}

export type OperationFailureReason =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "integration_error"
  | "unknown";

export type MoveFailureReason = OperationFailureReason;
export type DeleteFailureReason = OperationFailureReason;

export type MoveItemResult =
  | {
      conversationId: ConversationId;
      status: "success";
    }
  | {
      conversationId: ConversationId;
      status: "skipped";
      reason: "already_in_project";
      projectId: ProjectId;
    }
  | {
      conversationId: ConversationId;
      status: "failure";
      reason: MoveFailureReason;
      message: string;
    };

export interface MoveBatchResult {
  destinationProjectId: ProjectId;
  items: MoveItemResult[];
}

export type DeleteItemResult =
  | {
      conversationId: ConversationId;
      status: "success";
    }
  | {
      conversationId: ConversationId;
      status: "skipped";
      reason: "in_project";
      projectId: ProjectId;
    }
  | {
      conversationId: ConversationId;
      status: "failure";
      reason: DeleteFailureReason;
      message: string;
    };

export interface DeleteBatchResult {
  items: DeleteItemResult[];
}

export function uniqueConversations(
  conversations: readonly Conversation[],
): Conversation[] {
  const byId = new Map<ConversationId, Conversation>();

  for (const conversation of conversations) {
    if (!byId.has(conversation.id)) {
      byId.set(conversation.id, conversation);
    }
  }

  return [...byId.values()];
}

export function eligibleConversations(
  conversations: readonly Conversation[],
): Conversation[] {
  return conversations.filter((conversation) => conversation.projectId === null);
}

export function filterByFolder(
  conversations: readonly Conversation[],
  folder: ConversationFolder,
): Conversation[] {
  switch (folder.kind) {
    case "outside_project":
      return conversations.filter((conversation) => conversation.projectId === null);
    case "all":
      return [...conversations];
    case "project":
      return conversations.filter(
        (conversation) => conversation.projectId === folder.projectId,
      );
  }
}

export function countByFolder(
  conversations: readonly Conversation[],
  projects: readonly Project[],
): FolderCounts {
  const byProject = new Map<ProjectId, number>(projects.map((project) => [project.id, 0]));
  let outsideProject = 0;

  for (const conversation of conversations) {
    if (conversation.projectId === null) {
      outsideProject += 1;
    } else {
      byProject.set(conversation.projectId, (byProject.get(conversation.projectId) ?? 0) + 1);
    }
  }

  return { outsideProject, all: conversations.length, byProject };
}

export function filterByTitle(
  conversations: readonly Conversation[],
  query: string,
): Conversation[] {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (normalized.length === 0) {
    return [...conversations];
  }
  return conversations.filter((conversation) =>
    conversation.title.toLocaleLowerCase("pt-BR").includes(normalized),
  );
}

// Seleção por intervalo (Shift+clique): ids entre a âncora e o alvo, inclusive,
// na ordem visível, restritos aos selecionáveis. Sem âncora visível, o intervalo
// se reduz ao próprio alvo.
export function selectRange(
  orderedIds: readonly ConversationId[],
  anchorId: ConversationId | null,
  targetId: ConversationId,
  selectableIds: ReadonlySet<ConversationId>,
): ConversationId[] {
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = anchorId === null ? -1 : orderedIds.indexOf(anchorId);

  if (targetIndex === -1) {
    return [];
  }

  const start = anchorIndex === -1 ? targetIndex : Math.min(anchorIndex, targetIndex);
  const end = anchorIndex === -1 ? targetIndex : Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1).filter((id) => selectableIds.has(id));
}

// Arrastar um item selecionado leva a seleção inteira; arrastar um item não
// selecionado leva somente ele, sem alterar a seleção.
export function dragSet(
  draggedId: ConversationId,
  selectedIds: ReadonlySet<ConversationId>,
): ConversationId[] {
  return selectedIds.has(draggedId) ? [...selectedIds] : [draggedId];
}

export function createDeleteCommand(
  conversationIds: readonly ConversationId[],
): { conversationIds: ConversationId[] } {
  const uniqueIds = [...new Set(conversationIds.map((id) => id.trim()))].filter(
    (id) => id.length > 0,
  );

  if (uniqueIds.length === 0) {
    throw new Error("Selecione pelo menos uma conversa.");
  }

  return { conversationIds: uniqueIds };
}

export function createMoveCommand(
  conversationIds: readonly ConversationId[],
  destinationProjectId: ProjectId,
): { conversationIds: ConversationId[]; destinationProjectId: ProjectId } {
  const uniqueIds = [...new Set(conversationIds.map((id) => id.trim()))].filter(
    (id) => id.length > 0,
  );
  const destination = destinationProjectId.trim();

  if (uniqueIds.length === 0) {
    throw new Error("Selecione pelo menos uma conversa.");
  }

  if (destination.length === 0) {
    throw new Error("Escolha um Projeto de destino.");
  }

  return {
    conversationIds: uniqueIds,
    destinationProjectId: destination,
  };
}

