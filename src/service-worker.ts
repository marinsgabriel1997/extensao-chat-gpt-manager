import { createMoveCommand } from "./domain.js";
import { ChatGptClient } from "./integration.js";
import { logger } from "./logger.js";
import type { ExtensionRequest, ExtensionResponse, ResponseData } from "./messages.js";

const client = new ChatGptClient();

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

async function handleRequest(request: ExtensionRequest): Promise<ResponseData> {
  switch (request.type) {
    case "search":
      return client.searchEligibleConversations(request.query);
    case "list-projects":
      return client.listProjects();
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
    case "move": {
      const command = createMoveCommand(
        request.conversationIds,
        request.destinationProjectId,
      );
      return client.moveConversations(
        command.conversationIds,
        command.destinationProjectId,
      );
    }
    case "set-debug":
      logger.setEnabled(request.enabled);
      return { enabled: logger.isEnabled(), events: logger.getEvents() };
    case "get-debug-state":
      return { enabled: logger.isEnabled(), events: logger.getEvents() };
  }
}
