import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeleteCommand,
  createMoveCommand,
  countByFolder,
  dragSet,
  eligibleConversations,
  filterByFolder,
  filterByTitle,
  selectRange,
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

const folderConversations = [
  { id: "free", title: "Livre", preview: "", projectId: null, createdAt: null, updatedAt: null },
  { id: "projected", title: "Em Projeto", preview: "", projectId: "g-p-x", createdAt: null, updatedAt: null },
  { id: "other", title: "Outro Projeto", preview: "", projectId: "g-p-y", createdAt: null, updatedAt: null },
];

test("filterByFolder separa conversas por pasta", () => {
  assert.deepEqual(
    filterByFolder(folderConversations, { kind: "outside_project" }).map((item) => item.id),
    ["free"],
  );
  assert.deepEqual(
    filterByFolder(folderConversations, { kind: "project", projectId: "g-p-x" }).map(
      (item) => item.id,
    ),
    ["projected"],
  );
  assert.deepEqual(
    filterByFolder(folderConversations, { kind: "all" }).map((item) => item.id),
    ["free", "projected", "other"],
  );
});

test("countByFolder inclui Projetos vazios e Projetos ausentes da lista", () => {
  const counts = countByFolder(folderConversations, [
    { id: "g-p-x", name: "LIXEIRA" },
    { id: "g-p-empty", name: "Vazio" },
  ]);

  assert.equal(counts.outsideProject, 1);
  assert.equal(counts.all, 3);
  assert.deepEqual([...counts.byProject.entries()], [
    ["g-p-x", 1],
    ["g-p-empty", 0],
    ["g-p-y", 1],
  ]);
});

test("filterByTitle ignora maiúsculas e espaços externos", () => {
  assert.deepEqual(
    filterByTitle(folderConversations, "  projeto ").map((item) => item.id),
    ["projected", "other"],
  );
  assert.equal(filterByTitle(folderConversations, "   ").length, 3);
});

test("selectRange devolve o intervalo nos dois sentidos, só com selecionáveis", () => {
  const ordered = ["a", "b", "c", "d", "e"];
  const selectable = new Set(["a", "b", "d", "e"]);

  assert.deepEqual(selectRange(ordered, "b", "e", selectable), ["b", "d", "e"]);
  assert.deepEqual(selectRange(ordered, "e", "b", selectable), ["b", "d", "e"]);
});

test("selectRange sem âncora visível seleciona somente o alvo", () => {
  const selectable = new Set(["a", "b"]);

  assert.deepEqual(selectRange(["a", "b"], null, "b", selectable), ["b"]);
  assert.deepEqual(selectRange(["a", "b"], "fora", "b", selectable), ["b"]);
  assert.deepEqual(selectRange(["a", "b"], "a", "ausente", selectable), []);
});

test("dragSet leva a seleção inteira apenas quando o item arrastado está selecionado", () => {
  const selected = new Set(["a", "b"]);

  assert.deepEqual(dragSet("a", selected), ["a", "b"]);
  assert.deepEqual(dragSet("c", selected), ["c"]);
});

test("createDeleteCommand normaliza e elimina IDs duplicados", () => {
  const result = createDeleteCommand([" one ", "one", "two", ""]);

  assert.deepEqual(result, { conversationIds: ["one", "two"] });
});

test("createDeleteCommand rejeita seleção vazia", () => {
  assert.throws(() => createDeleteCommand([]), /Selecione/);
  assert.throws(() => createDeleteCommand(["  ", ""]), /Selecione/);
});

