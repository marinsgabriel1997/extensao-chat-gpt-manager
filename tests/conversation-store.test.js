import assert from "node:assert/strict";
import test from "node:test";

import { ConversationStore } from "../dist/conversation-store.js";

function createFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key) => {
      delete data[key];
      return Promise.resolve();
    },
  };
}

const snapshot = {
  fetchedAt: "2026-08-05T12:00:00.000Z",
  conversations: [
    {
      id: "free",
      title: "Livre",
      preview: "",
      projectId: null,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    { id: "projected", title: "Em Projeto", preview: "", projectId: "g-p-x", createdAt: null, updatedAt: null },
  ],
  projects: [{ id: "g-p-x", name: "LIXEIRA" }],
};

test("write e read preservam o snapshot completo", async () => {
  const store = new ConversationStore(createFakeStorage());

  await store.write(snapshot);
  const cached = await store.read();

  assert.deepEqual(cached, snapshot);
});

test("cache da versão 1 continua legível, com createdAt nulo", async () => {
  const storage = createFakeStorage({
    "conversation-cache": {
      version: 1,
      fetchedAt: "2026-08-05T12:00:00.000Z",
      conversations: [
        { id: "free", title: "Livre", preview: "", projectId: null, updatedAt: "2026-08-01T00:00:00Z" },
      ],
      projects: [],
    },
  });
  const store = new ConversationStore(storage);

  const cached = await store.read();

  assert.equal(cached?.conversations[0]?.createdAt, null);
  assert.equal(cached?.conversations[0]?.updatedAt, "2026-08-01T00:00:00Z");
});

test("write grava sempre a versão atual", async () => {
  const storage = createFakeStorage();
  await new ConversationStore(storage).write(snapshot);

  assert.equal(storage.data["conversation-cache"].version, 2);
});

test("read retorna null quando não há cache", async () => {
  const store = new ConversationStore(createFakeStorage());

  assert.equal(await store.read(), null);
});

test("cache de versão desconhecida é descartado", async () => {
  const storage = createFakeStorage({
    "conversation-cache": { version: 99, fetchedAt: "x", conversations: [], projects: [] },
  });
  const store = new ConversationStore(storage);

  assert.equal(await store.read(), null);
  assert.equal("conversation-cache" in storage.data, false);
});

test("cache com conversa malformada é descartado por inteiro", async () => {
  const storage = createFakeStorage({
    "conversation-cache": {
      version: 1,
      fetchedAt: "2026-08-05T12:00:00.000Z",
      conversations: [{ id: "", title: "Sem id", preview: "", projectId: null, updatedAt: null }],
      projects: [],
    },
  });
  const store = new ConversationStore(storage);

  assert.equal(await store.read(), null);
});

test("removeConversations remove somente os IDs indicados", async () => {
  const store = new ConversationStore(createFakeStorage());
  await store.write(snapshot);

  await store.removeConversations(new Set(["free"]));
  const cached = await store.read();

  assert.deepEqual(
    cached?.conversations.map((conversation) => conversation.id),
    ["projected"],
  );
});

test("assignProject atualiza o vínculo das conversas indicadas", async () => {
  const store = new ConversationStore(createFakeStorage());
  await store.write(snapshot);

  await store.assignProject(new Set(["free"]), "g-p-destino");
  const cached = await store.read();

  assert.equal(
    cached?.conversations.find((conversation) => conversation.id === "free")?.projectId,
    "g-p-destino",
  );
  assert.equal(
    cached?.conversations.find((conversation) => conversation.id === "projected")?.projectId,
    "g-p-x",
  );
});

test("removeConversations e assignProject ignoram conjuntos vazios sem cache", async () => {
  const store = new ConversationStore(createFakeStorage());

  await store.removeConversations(new Set());
  await store.assignProject(new Set(), "g-p-x");
  await store.removeConversations(new Set(["free"]));

  assert.equal(await store.read(), null);
});
