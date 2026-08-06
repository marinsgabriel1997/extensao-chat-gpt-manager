export type ConversationId = string;
export type ProjectId = string;

export interface Conversation {
  id: ConversationId;
  title: string;
  preview: string;
  projectId: ProjectId | null;
  updatedAt: string | null;
}

export type ConversationScopeFilter = "outside_project" | "in_project" | "all";

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

export function filterByScope(
  conversations: readonly Conversation[],
  filter: ConversationScopeFilter,
): Conversation[] {
  switch (filter) {
    case "outside_project":
      return conversations.filter((conversation) => conversation.projectId === null);
    case "in_project":
      return conversations.filter((conversation) => conversation.projectId !== null);
    case "all":
      return [...conversations];
  }
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

