import assert from "node:assert/strict";
import test from "node:test";

import { SearchSessionCache } from "../dist/search-cache.js";

const hitOne = { id: "one", title: "Primeira", snippet: "Trecho", updatedAt: null };
const hitTwo = { id: "two", title: "Segunda", snippet: "Trecho", updatedAt: null };

test("SearchSessionCache normaliza a query", () => {
  const cache = new SearchSessionCache();
  cache.set("  TypeScript ", { hits: [hitOne] });

  assert.deepEqual(cache.get("typescript"), { hits: [hitOne] });
});

test("SearchSessionCache devolve cópias independentes", () => {
  const cache = new SearchSessionCache();
  cache.set("query", { hits: [hitOne] });
  const firstRead = cache.get("query");
  firstRead.hits.length = 0;

  assert.equal(cache.get("query").hits.length, 1);
});

test("SearchSessionCache remove conversas excluídas de todas as pesquisas", () => {
  const cache = new SearchSessionCache();
  cache.set("first", { hits: [hitOne, hitTwo] });
  cache.set("second", { hits: [hitOne] });

  cache.removeConversations(new Set(["one"]));

  assert.deepEqual(cache.get("first").hits.map((hit) => hit.id), ["two"]);
  assert.deepEqual(cache.get("second"), { hits: [] });
});
