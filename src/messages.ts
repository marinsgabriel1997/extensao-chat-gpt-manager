import type {
  Conversation,
  DeleteBatchResult,
  MoveBatchResult,
  Project,
} from "./domain.js";
import type { DebugEvent } from "./logger.js";

export type ExtensionRequest =
  | { type: "search"; query: string }
  | { type: "list-projects" }
  | { type: "list-project-names" }
  | { type: "list-all-conversations"; refresh: boolean }
  | { type: "get-cached-conversations" }
  | { type: "open-conversation"; conversationId: string }
  | {
      type: "record-cache-event";
      name: "hit" | "miss" | "items_removed";
      context: Record<string, unknown>;
    }
  | {
      type: "move";
      conversationIds: string[];
      destinationProjectId: string;
    }
  | { type: "delete"; conversationIds: string[] }
  | { type: "set-debug"; enabled: boolean }
  | { type: "get-debug-state" };

// Eventos vão do service worker para o painel e não passam por `handleRequest`:
// são unidirecionais e nunca esperam resposta.
export type ExtensionEvent = {
  type: "operation-progress";
  operation: "move" | "delete" | "inventory";
  phase: "working" | "waiting";
  done: number;
  total: number;
  title: string | null;
};

export interface DebugState {
  enabled: boolean;
  events: DebugEvent[];
}

export interface ConversationInventory {
  conversations: Conversation[];
  projects: Project[];
  fetchedAt: string;
  fromCache: boolean;
}

export type ResponseData =
  | { conversations: Conversation[]; filteredCount: number }
  | Project[]
  | ConversationInventory
  | { inventory: ConversationInventory | null }
  | MoveBatchResult
  | DeleteBatchResult
  | DebugState
  | { opened: true }
  | { recorded: true };

export type ExtensionResponse =
  | { ok: true; data: ResponseData }
  | { ok: false; error: string };
