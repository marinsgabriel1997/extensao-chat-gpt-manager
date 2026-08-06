import { ConversationStore, type KeyValueStorage } from "./conversation-store.js";
import {
  createDeleteCommand,
  createMoveCommand,
  type DeleteItemResult,
  type MoveItemResult,
} from "./domain.js";
import { ChatGptClient, type ProgressListener } from "./integration.js";
import { logger } from "./logger.js";
import type {
  ConversationInventory,
  ExtensionEvent,
  ExtensionRequest,
  ExtensionResponse,
  ResponseData,
} from "./messages.js";

const client = new ChatGptClient();

const localStorageArea: KeyValueStorage = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
  remove: (key) => chrome.storage.local.remove(key),
};

const conversationStore = new ConversationStore(localStorageArea);

void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => {
    logger.error("extension", "side_panel_configuration_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: ExtensionResponse) => void,
  ): true => {
    void handleRequest(request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Erro inesperado.";
        logger.error("extension", "request_failed", { type: request.type, message });
        sendResponse({ ok: false, error: message });
      });

    return true;
  },
);

// A camada de integração não conhece as APIs do Chrome: ela recebe um callback
// puro e é o worker quem publica o evento. Painel fechado faz o envio rejeitar,
// o que é situação normal e não interrompe a operação.
function progressListener(operation: ExtensionEvent["operation"]): ProgressListener {
  return (progress) => {
    const event: ExtensionEvent = {
      type: "operation-progress",
      operation,
      phase: progress.phase,
      done: progress.done,
      total: progress.total,
      title: progress.title,
    };
    void chrome.runtime.sendMessage(event).catch(() => undefined);
  };
}

async function handleRequest(request: ExtensionRequest): Promise<ResponseData> {
  switch (request.type) {
    case "search":
      return client.searchEligibleConversations(request.query);
    case "list-projects":
      return client.listProjects();
    case "list-project-names":
      return client.listProjectNames();
    case "open-conversation": {
      const conversationId = request.conversationId.trim();
      if (conversationId.length === 0) {
        throw new Error("Identificador de conversa inválido.");
      }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined) {
        throw new Error("Não foi possível identificar a aba ativa.");
      }
      await chrome.tabs.update(activeTab.id, {
        url: `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`,
      });
      logger.info("navigation", "conversation_opened", { conversationId, tabId: activeTab.id });
      return { opened: true };
    }
    case "record-cache-event":
      logger.debug("cache", request.name, request.context);
      return { recorded: true };
    case "list-all-conversations":
      return listAllConversations(request.refresh);
    case "get-cached-conversations": {
      const cached = await conversationStore.read();
      logger.info("inventory", cached === null ? "cache_miss" : "cache_hit", {
        conversations: cached?.conversations.length ?? 0,
      });
      return { inventory: cached === null ? null : { ...cached, fromCache: true } };
    }
    case "move": {
      const command = createMoveCommand(
        request.conversationIds,
        request.destinationProjectId,
      );
      const result = await client.moveConversations(
        command.conversationIds,
        command.destinationProjectId,
        progressListener("move"),
      );
      await syncStoreAfterMove(result.items, result.destinationProjectId);
      return result;
    }
    case "delete": {
      const command = createDeleteCommand(request.conversationIds);
      const result = await client.deleteConversations(
        command.conversationIds,
        progressListener("delete"),
      );
      await syncStoreAfterDelete(result.items);
      return result;
    }
    case "set-debug":
      logger.setEnabled(request.enabled);
      return { enabled: logger.isEnabled(), events: logger.getEvents() };
    case "get-debug-state":
      return { enabled: logger.isEnabled(), events: logger.getEvents() };
  }
}

async function listAllConversations(refresh: boolean): Promise<ConversationInventory> {
  if (!refresh) {
    const cached = await conversationStore.read();
    if (cached !== null) {
      logger.info("inventory", "cache_hit", {
        conversations: cached.conversations.length,
        fetchedAt: cached.fetchedAt,
      });
      return { ...cached, fromCache: true };
    }
    logger.info("inventory", "cache_miss");
  }

  const projects = await client.listProjectNames();
  const conversations = await client.listAllConversations(progressListener("inventory"));
  const fetchedAt = new Date().toISOString();
  const snapshot = { fetchedAt, conversations, projects };
  await conversationStore.write(snapshot);
  return { ...snapshot, fromCache: false };
}

async function syncStoreAfterMove(
  items: MoveItemResult[],
  destinationProjectId: string,
): Promise<void> {
  try {
    const movedIds = new Set(
      items
        .filter((item) => item.status === "success")
        .map((item) => item.conversationId),
    );
    await conversationStore.assignProject(movedIds, destinationProjectId);

    for (const item of items) {
      if (item.status === "skipped") {
        await conversationStore.assignProject(new Set([item.conversationId]), item.projectId);
      }
    }
  } catch (error) {
    logger.warn("inventory", "cache_sync_failed", {
      operation: "move",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function syncStoreAfterDelete(items: DeleteItemResult[]): Promise<void> {
  try {
    const deletedIds = new Set(
      items
        .filter((item) => item.status === "success")
        .map((item) => item.conversationId),
    );
    await conversationStore.removeConversations(deletedIds);

    for (const item of items) {
      if (item.status === "skipped") {
        await conversationStore.assignProject(new Set([item.conversationId]), item.projectId);
      }
    }
  } catch (error) {
    logger.warn("inventory", "cache_sync_failed", {
      operation: "delete",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
