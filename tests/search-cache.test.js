import assert from "node:assert/strict";
import test from "node:test";

import { SearchSessionCache } from "../dist/search-cache.js";

const conversationOne = {
  id: "one",
  title: "Primeira",
  preview: "Texto",
  projectId: null,
};
const conversationTwo = {
  id: "two",
  title: "Segunda",
  preview: "Texto",
  projectId: null,
};

test("SearchSessionCache normaliza a query", () => {
  const cache = new SearchSessionCache();
  cache.set("  TypeScript ", {
    conversations: [conversationOne],
    filteredCount: 2,
  });

  assert.deepEqual(cache.get("typescript"), {
    conversations: [conversationOne],
    filteredCount: 2,
  });
});

test("SearchSessionCache devolve cópias independentes", () => {
  const cache = new SearchSessionCache();
  cache.set("query", { conversations: [conversationOne], filteredCount: 0 });
  const firstRead = cache.get("query");
  firstRead.conversations.length = 0;

  assert.equal(cache.get("query").conversations.length, 1);
});

test("SearchSessionCache remove conversas movidas de todas as pesquisas", () => {
  const cache = new SearchSessionCache();
  cache.set("first", {
    conversations: [conversationOne, conversationTwo],
    filteredCount: 0,
  });
  cache.set("second", {
    conversations: [conversationOne],
    filteredCount: 3,
  });

  cache.removeConversations(new Set(["one"]));

  assert.deepEqual(
    cache.get("first").conversations.map((conversation) => conversation.id),
    ["two"],
  );
  assert.deepEqual(cache.get("second"), {
    conversations: [],
    filteredCount: 3,
  });
});

