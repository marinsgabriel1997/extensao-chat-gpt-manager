import type { Conversation, MoveBatchResult, Project } from "./domain.js";
import type { DebugEvent } from "./logger.js";

export type ExtensionRequest =
  | { type: "search"; query: string }
  | { type: "list-projects" }
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
  | { type: "set-debug"; enabled: boolean }
  | { type: "get-debug-state" };

export interface DebugState {
  enabled: boolean;
  events: DebugEvent[];
}

export type ResponseData =
  | { conversations: Conversation[]; filteredCount: number }
  | Project[]
  | MoveBatchResult
  | DebugState
  | { opened: true }
  | { recorded: true };

export type ExtensionResponse =
  | { ok: true; data: ResponseData }
  | { ok: false; error: string };
