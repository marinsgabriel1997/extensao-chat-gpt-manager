import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationFromPayload,
  conversationFromSearchPayload,
} from "../dist/integration.js";

test("conversationFromSearchPayload usa o snippet retornado pela pesquisa", () => {
  const conversation = conversationFromSearchPayload({
    conversation_id: "conversation-search",
    title: "Resultado",
    payload: { kind: "message", snippet: "Trecho encontrado" },
  });

  assert.deepEqual(conversation, {
    id: "conversation-search",
    title: "Resultado",
    preview: "Trecho encontrado",
    projectId: null,
  });
});

test("conversationFromPayload usa a primeira mensagem textual visível do usuário", () => {
  const conversation = conversationFromPayload({
    conversation_id: "conversation-one",
    title: "Exemplo",
    current_node: "assistant",
    mapping: {
      root: { message: null, parent: null },
      hidden: {
        parent: "root",
        message: {
          author: { role: "user" },
          content: { content_type: "user_editable_context" },
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
      user: {
        parent: "hidden",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Primeira pergunta"] },
          metadata: {},
        },
      },
      assistant: {
        parent: "user",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Resposta"] },
          metadata: {},
        },
      },
    },
  });

  assert.equal(conversation?.preview, "Primeira pergunta");
});

test("conversationFromPayload não usa mensagens fora do caminho ativo", () => {
  const conversation = conversationFromPayload({
    conversation_id: "conversation-two",
    title: "Exemplo",
    current_node: "active-assistant",
    mapping: {
      root: { message: null, parent: null },
      abandoned: {
        parent: "root",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Ramo abandonado"] },
          metadata: {},
        },
      },
      "active-user": {
        parent: "root",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Ramo ativo"] },
          metadata: {},
        },
      },
      "active-assistant": {
        parent: "active-user",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Resposta"] },
          metadata: {},
        },
      },
    },
  });

  assert.equal(conversation?.preview, "Ramo ativo");
});
