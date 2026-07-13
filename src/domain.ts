export type ConversationId = string;
export type ProjectId = string;

export interface Conversation {
  id: ConversationId;
  title: string;
  preview: string;
  projectId: ProjectId | null;
}

export interface Project {
  id: ProjectId;
  name: string;
}

export type MoveFailureReason =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "integration_error"
  | "unknown";

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

