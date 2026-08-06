import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeleteCommand,
  createMoveCommand,
  eligibleConversations,
  filterByScope,
  uniqueConversations,
} from "../dist/domain.js";

test("uniqueConversations preserva a primeira ocorrência de cada ID", () => {
  const result = uniqueConversations([
    { id: "one", title: "Primeira", preview: "Texto", projectId: null },
    { id: "one", title: "Duplicada", preview: "Texto", projectId: null },
    { id: "two", title: "Segunda", preview: "Texto", projectId: null },
  ]);

  assert.deepEqual(
    result.map((conversation) => conversation.title),
    ["Primeira", "Segunda"],
  );
});

test("eligibleConversations remove todas as conversas vinculadas a Projetos", () => {
  const result = eligibleConversations([
    { id: "free", title: "Livre", preview: "Texto", projectId: null },
    { id: "projected", title: "Em Projeto", preview: "Texto", projectId: "g-p-project" },
  ]);

  assert.deepEqual(result.map((conversation) => conversation.id), ["free"]);
});

test("createMoveCommand normaliza e elimina IDs duplicados", () => {
  const result = createMoveCommand([" one ", "one", "two", ""], " g-p-target ");

  assert.deepEqual(result, {
    conversationIds: ["one", "two"],
    destinationProjectId: "g-p-target",
  });
});

test("createMoveCommand rejeita seleção vazia", () => {
  assert.throws(() => createMoveCommand([], "g-p-target"), /Selecione/);
});

test("createMoveCommand rejeita Projeto vazio", () => {
  assert.throws(() => createMoveCommand(["one"], "  "), /Projeto/);
});

const scopedConversations = [
  { id: "free", title: "Livre", preview: "", projectId: null, updatedAt: null },
  { id: "projected", title: "Em Projeto", preview: "", projectId: "g-p-x", updatedAt: null },
];

test("filterByScope separa conversas fora e dentro de Projetos", () => {
  assert.deepEqual(
    filterByScope(scopedConversations, "outside_project").map((item) => item.id),
    ["free"],
  );
  assert.deepEqual(
    filterByScope(scopedConversations, "in_project").map((item) => item.id),
    ["projected"],
  );
  assert.deepEqual(
    filterByScope(scopedConversations, "all").map((item) => item.id),
    ["free", "projected"],
  );
});

test("createDeleteCommand normaliza e elimina IDs duplicados", () => {
  const result = createDeleteCommand([" one ", "one", "two", ""]);

  assert.deepEqual(result, { conversationIds: ["one", "two"] });
});

test("createDeleteCommand rejeita seleção vazia", () => {
  assert.throws(() => createDeleteCommand([]), /Selecione/);
  assert.throws(() => createDeleteCommand(["  ", ""]), /Selecione/);
});

