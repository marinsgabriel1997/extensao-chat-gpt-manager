import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  ChatGptClient,
  conversationContextFromPayload,
  conversationFromPayload,
  searchHitFromPayload,
} from "../dist/integration.js";

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
  };
}

test("searchHitFromPayload usa o snippet e converte update_time numérico", () => {
  const hit = searchHitFromPayload({
    conversation_id: "conversation-search",
    title: "Resultado",
    update_time: 1700000000,
    payload: { kind: "message", snippet: "Trecho encontrado" },
  });

  assert.deepEqual(hit, {
    id: "conversation-search",
    title: "Resultado",
    snippet: "Trecho encontrado",
    updatedAt: "2023-11-14T22:13:20.000Z",
  });
});

test("conversationFromPayload converte datas numéricas e textuais para ISO 8601", () => {
  const fromDetail = conversationFromPayload({
    id: "detail",
    title: "Detalhe",
    create_time: 1700000000.5,
    update_time: "1700000000",
  });
  const invalid = conversationFromPayload({
    id: "invalid",
    title: "Inválida",
    create_time: "não é data",
    update_time: null,
  });

  assert.equal(fromDetail?.createdAt, "2023-11-14T22:13:20.500Z");
  assert.equal(fromDetail?.updatedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(invalid?.createdAt, null);
  assert.equal(invalid?.updatedAt, null);
});

test("conversationContextFromPayload extrai a primeira pergunta e a última resposta da captura", () => {
  const capture = JSON.parse(
    readFileSync(new URL("../docs/conversation-detail-response.example.json", import.meta.url), "utf8"),
  );

  const context = conversationContextFromPayload("captura", capture);

  assert.equal(context.conversationId, "captura");
  assert.notEqual(context.firstUserMessage, "");
  assert.notEqual(context.lastAssistantMessage, "");
});

test("conversationContextFromPayload ignora raciocínio, mensagens ocultas e chamadas a ferramentas", () => {
  const message = (role, contentType, parts, extra = {}) => ({
    author: { role },
    content: { content_type: contentType, parts },
    metadata: {},
    ...extra,
  });

  const context = conversationContextFromPayload("c", {
    current_node: "recap",
    mapping: {
      root: { parent: null, message: null },
      user: { parent: "root", message: message("user", "text", ["Pergunta"]) },
      answer: { parent: "user", message: message("assistant", "text", ["Resposta final"], { recipient: "all" }) },
      tool: { parent: "answer", message: message("assistant", "text", ["chamada"], { recipient: "web" }) },
      hidden: {
        parent: "tool",
        message: {
          ...message("assistant", "text", ["oculta"]),
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
      thoughts: { parent: "hidden", message: message("assistant", "thoughts", ["pensando"]) },
      recap: { parent: "thoughts", message: message("assistant", "reasoning_recap", ["resumo"]) },
    },
  });

  assert.deepEqual(context, {
    conversationId: "c",
    firstUserMessage: "Pergunta",
    lastAssistantMessage: "Resposta final",
  });
});

test("conversationContextFromPayload devolve textos vazios sem mensagens visíveis", () => {
  assert.deepEqual(conversationContextFromPayload("vazia", { mapping: null }), {
    conversationId: "vazia",
    firstUserMessage: "",
    lastAssistantMessage: "",
  });
});

test("conversationFromPayload extrai updatedAt e o vínculo com Projeto da listagem", () => {
  const conversation = conversationFromPayload({
    id: "conversation-list",
    title: "Listada",
    update_time: "2026-07-24T13:00:58.594377Z",
    gizmo_id: "g-p-project",
    mapping: null,
    current_node: null,
  });

  assert.deepEqual(conversation, {
    id: "conversation-list",
    title: "Listada",
    preview: "",
    projectId: "g-p-project",
    createdAt: null,
    updatedAt: "2026-07-24T13:00:58.594377Z",
  });
});

test("listAllConversations pagina até a página incompleta, deduplica e ignora o total", async () => {
  const originalFetch = globalThis.fetch;
  const pageRequests = [];

  globalThis.fetch = (input) => {
    const url = new URL(input instanceof URL ? input.href : String(input));

    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(jsonResponse({ accessToken: "token-de-teste" }));
    }

    if (url.pathname === "/backend-api/conversations") {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      pageRequests.push({ offset, limit });

      const items =
        offset === 0
          ? Array.from({ length: limit }, (_, index) => ({
              id: `conversation-${index}`,
              title: `Conversa ${index}`,
              update_time: "2026-08-01T00:00:00Z",
              gizmo_id: index === 0 ? "g-p-project" : null,
              mapping: null,
            }))
          : [
              {
                id: "conversation-0",
                title: "Duplicada",
                update_time: "2026-08-01T00:00:00Z",
                gizmo_id: null,
                mapping: null,
              },
              {
                id: "conversation-final",
                title: "Última",
                update_time: "2026-08-01T00:00:00Z",
                gizmo_id: null,
                mapping: null,
              },
            ];

      // `total` deliberadamente enganoso (offset + limit + 1), como observado.
      return Promise.resolve(
        jsonResponse({ items, total: offset + limit + 1, limit, offset }),
      );
    }

    return Promise.reject(new Error(`Requisição inesperada: ${url.href}`));
  };

  try {
    const client = new ChatGptClient();
    const conversations = await client.listAllConversations();

    assert.equal(pageRequests.length, 2);
    assert.equal(pageRequests[1].offset, pageRequests[0].limit);
    assert.equal(conversations.length, pageRequests[0].limit + 1);
    assert.equal(
      conversations.filter((conversation) => conversation.id === "conversation-0").length,
      1,
    );
    assert.equal(conversations[0].projectId, "g-p-project");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conversationFromPayload não trata GPT customizado (g- sem -p-) como Projeto", () => {
  const conversation = conversationFromPayload({
    id: "conversation-gpt",
    title: "Conversa de GPT",
    update_time: "2026-07-24T13:00:58.594377Z",
    gizmo_id: "g-custom-gpt",
    conversation_template_id: "g-custom-gpt",
    mapping: null,
    current_node: null,
  });

  assert.equal(conversation?.projectId, null);
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

// --- Resiliência: espera de rate limit, retry com backoff e progresso ---

function errorResponse(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve({}),
    clone: () => errorResponse(status, headers),
  };
}

function conversationResponse(conversationId, projectId = null) {
  return jsonResponse({
    conversation_id: conversationId,
    title: `Conversa ${conversationId}`,
    gizmo_id: projectId,
    mapping: null,
    current_node: null,
  });
}

// Tempo e aleatoriedade injetados: a suíte não espera tempo real e os delays de
// backoff ficam determinísticos.
function fakeDependencies(random = 0.5) {
  const sleeps = [];
  let clock = 0;
  return {
    sleeps,
    dependencies: {
      now: () => clock,
      sleep: (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      random: () => random,
    },
  };
}

// `routes` é uma lista de { match(method, pathname), respond(attempt) }.
function installFetch(routes) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const method = init.method ?? "GET";

    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(jsonResponse({ accessToken: "token-de-teste" }));
    }

    const route = routes.find((candidate) => candidate.match(method, url.pathname));
    if (route === undefined) {
      return Promise.reject(new Error(`Requisição inesperada: ${method} ${url.pathname}`));
    }

    const attempt = calls.filter((call) => call.route === route).length + 1;
    calls.push({ route, method, pathname: url.pathname, attempt });
    return route.respond(attempt, url);
  };

  return {
    calls,
    countFor: (route) => calls.filter((call) => call.route === route).length,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

// Delays de pacing (500 ms entre requisições) não interessam às asserções de backoff.
function backoffSleeps(sleeps) {
  return sleeps.filter((ms) => ms !== 500);
}

test("fetchJson retenta status transitório com backoff exponencial", async () => {
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: (attempt) =>
      Promise.resolve(attempt < 3 ? errorResponse(503) : jsonResponse({ items: [] })),
  };
  const fetchStub = installFetch([listRoute]);
  const { sleeps, dependencies } = fakeDependencies();

  try {
    const client = new ChatGptClient(dependencies);
    const conversations = await client.listAllConversations();

    assert.deepEqual(conversations, []);
    assert.equal(fetchStub.countFor(listRoute), 3);
    assert.deepEqual(backoffSleeps(sleeps), [1_000, 2_000]);
  } finally {
    fetchStub.restore();
  }
});

test("o jitter mantém o backoff dentro da faixa de ±25%", async () => {
  for (const [random, expected] of [
    [0, [750, 1_500]],
    [1, [1_250, 2_500]],
  ]) {
    const listRoute = {
      match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
      respond: (attempt) =>
        Promise.resolve(attempt < 3 ? errorResponse(500) : jsonResponse({ items: [] })),
    };
    const fetchStub = installFetch([listRoute]);
    const { sleeps, dependencies } = fakeDependencies(random);

    try {
      await new ChatGptClient(dependencies).listAllConversations();
      assert.deepEqual(backoffSleeps(sleeps), expected);
    } finally {
      fetchStub.restore();
    }
  }
});

test("falha de rede é retentada", async () => {
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: (attempt) =>
      attempt === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(jsonResponse({ items: [] })),
  };
  const fetchStub = installFetch([listRoute]);
  const { dependencies } = fakeDependencies();

  try {
    await new ChatGptClient(dependencies).listAllConversations();
    assert.equal(fetchStub.countFor(listRoute), 2);
  } finally {
    fetchStub.restore();
  }
});

test("404 não é retentado e permanece como falha do item", async () => {
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname === "/backend-api/conversation/conversation-1",
    respond: () => Promise.resolve(conversationResponse("conversation-1")),
  };
  const deleteRoute = {
    match: (method, pathname) =>
      method === "DELETE" && pathname === "/backend-api/conversation/id/conversation-1",
    respond: () => Promise.resolve(errorResponse(404)),
  };
  const fetchStub = installFetch([detailRoute, deleteRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "conversation-1",
    ]);

    assert.equal(fetchStub.countFor(deleteRoute), 1);
    assert.equal(result.items[0].status, "failure");
    assert.equal(result.items[0].reason, "not_found");
  } finally {
    fetchStub.restore();
  }
});

test("exclusão que responde 404 em retentativa é tratada como sucesso", async () => {
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname === "/backend-api/conversation/conversation-1",
    respond: () => Promise.resolve(conversationResponse("conversation-1")),
  };
  // A primeira exclusão chega ao servidor, mas a resposta se perde; a retentativa
  // encontra a conversa já removida.
  const deleteRoute = {
    match: (method, pathname) =>
      method === "DELETE" && pathname === "/backend-api/conversation/id/conversation-1",
    respond: (attempt) =>
      attempt === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(errorResponse(404)),
  };
  const fetchStub = installFetch([detailRoute, deleteRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "conversation-1",
    ]);

    assert.equal(fetchStub.countFor(deleteRoute), 2);
    assert.equal(result.items[0].status, "success");
  } finally {
    fetchStub.restore();
  }
});

test("esgotar as tentativas produz falha do item com o motivo traduzido", async () => {
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname === "/backend-api/conversation/conversation-1",
    respond: () => Promise.resolve(errorResponse(500)),
  };
  const fetchStub = installFetch([detailRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "conversation-1",
    ]);

    assert.equal(fetchStub.countFor(detailRoute), 3);
    assert.equal(result.items[0].status, "failure");
    assert.equal(result.items[0].reason, "integration_error");
  } finally {
    fetchStub.restore();
  }
});

test("429 faz o lote esperar a janela e continuar em vez de falhar em cascata", async () => {
  const detailRoute = {
    match: (method, pathname) => method === "GET" && pathname.startsWith("/backend-api/conversation/"),
    respond: (attempt, url) =>
      Promise.resolve(conversationResponse(url.pathname.split("/").pop())),
  };
  const deleteRoute = {
    match: (method, pathname) =>
      method === "DELETE" && pathname.startsWith("/backend-api/conversation/id/"),
    respond: (attempt) =>
      Promise.resolve(
        attempt === 1
          ? errorResponse(429, { "retry-after": "5" })
          : jsonResponse({ success: true }),
      ),
  };
  const fetchStub = installFetch([detailRoute, deleteRoute]);
  const { sleeps, dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "conversation-1",
      "conversation-2",
    ]);

    // O item que tomou 429 é retentado após a janela e o lote inteiro conclui.
    assert.deepEqual(
      result.items.map((item) => item.status),
      ["success", "success"],
    );
    // A espera pela janela é maior que o pacing (500 ms) e que o backoff base.
    assert.ok(sleeps.some((ms) => ms >= 3_000));
  } finally {
    fetchStub.restore();
  }
});

test("janela de rate limit acima do teto falha sem esperar", async () => {
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname === "/backend-api/conversation/conversation-1",
    respond: () => Promise.resolve(errorResponse(429, { "retry-after": "600" })),
  };
  const fetchStub = installFetch([detailRoute]);
  const { sleeps, dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "conversation-1",
    ]);

    assert.equal(result.items[0].status, "failure");
    assert.equal(result.items[0].reason, "rate_limited");
    assert.ok(!sleeps.some((ms) => ms > 120_000));
  } finally {
    fetchStub.restore();
  }
});

function listingResponse(items) {
  return jsonResponse({ items, total: items.length, limit: 100, offset: 0 });
}

test("a revalidação em lote dispensa o GET de detalhe por item", async () => {
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: () =>
      Promise.resolve(
        listingResponse([
          { id: "fora", title: "Fora", gizmo_id: null, mapping: null },
          { id: "dentro", title: "Dentro", gizmo_id: "g-p-projeto", mapping: null },
        ]),
      ),
  };
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname.startsWith("/backend-api/conversation/"),
    respond: () => Promise.reject(new Error("GET de detalhe não deveria ser chamado")),
  };
  const deleteRoute = {
    match: (method, pathname) =>
      method === "DELETE" && pathname.startsWith("/backend-api/conversation/id/"),
    respond: () => Promise.resolve(jsonResponse({ success: true })),
  };
  const fetchStub = installFetch([listRoute, deleteRoute, detailRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations([
      "fora",
      "dentro",
    ]);

    assert.equal(fetchStub.countFor(listRoute), 1);
    assert.equal(fetchStub.countFor(detailRoute), 0);
    assert.equal(result.items[0].status, "success");
    assert.equal(result.items[1].status, "skipped");
    assert.equal(result.items[1].projectId, "g-p-projeto");
  } finally {
    fetchStub.restore();
  }
});

test("coletas simultâneas compartilham uma única paginação", async () => {
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: () =>
      Promise.resolve(listingResponse([{ id: "unica", title: "Única", gizmo_id: null }])),
  };
  const fetchStub = installFetch([listRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const client = new ChatGptClient(dependencies);
    const [first, second] = await Promise.all([
      client.listAllConversations(),
      client.listAllConversations(),
    ]);

    assert.equal(fetchStub.countFor(listRoute), 1);
    assert.deepEqual(first, second);
  } finally {
    fetchStub.restore();
  }
});

test("a revalidação em lote aproveita a coleta já em andamento", async () => {
  let releasePage = () => undefined;
  const firstPageDelivered = new Promise((resolve) => {
    releasePage = resolve;
  });
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: () => {
      releasePage();
      return Promise.resolve(
        listingResponse([{ id: "alvo", title: "Alvo", gizmo_id: "g-p-projeto" }]),
      );
    },
  };
  const deleteRoute = {
    match: (method, pathname) =>
      method === "DELETE" && pathname.startsWith("/backend-api/conversation/id/"),
    respond: () => Promise.reject(new Error("não deveria excluir conversa em Projeto")),
  };
  const fetchStub = installFetch([listRoute, deleteRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const client = new ChatGptClient(dependencies);
    const listing = client.listAllConversations();
    await firstPageDelivered;
    const result = await client.deleteConversations(["alvo"]);
    await listing;

    // Uma única paginação serviu à coleta e à revalidação do lote.
    assert.equal(fetchStub.countFor(listRoute), 1);
    assert.equal(result.items[0].status, "skipped");
  } finally {
    fetchStub.restore();
  }
});

test("id ausente da listagem cai no GET de detalhe individual", async () => {
  const listRoute = {
    match: (method, pathname) => method === "GET" && pathname === "/backend-api/conversations",
    respond: () => Promise.resolve(listingResponse([])),
  };
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname === "/backend-api/conversation/ausente",
    respond: () => Promise.resolve(conversationResponse("ausente", "g-p-projeto")),
  };
  const fetchStub = installFetch([listRoute, detailRoute]);
  const { dependencies } = fakeDependencies();

  try {
    const result = await new ChatGptClient(dependencies).deleteConversations(["ausente"]);

    assert.equal(fetchStub.countFor(detailRoute), 1);
    assert.equal(result.items[0].status, "skipped");
  } finally {
    fetchStub.restore();
  }
});

test("moveConversations reporta progresso item a item", async () => {
  const detailRoute = {
    match: (method, pathname) =>
      method === "GET" && pathname.startsWith("/backend-api/conversation/"),
    respond: (attempt, url) =>
      Promise.resolve(conversationResponse(url.pathname.split("/").pop())),
  };
  const patchRoute = {
    match: (method, pathname) =>
      method === "PATCH" && pathname.startsWith("/backend-api/conversation/"),
    respond: () => Promise.resolve(jsonResponse({ success: true })),
  };
  const fetchStub = installFetch([patchRoute, detailRoute]);
  const { dependencies } = fakeDependencies();
  const reports = [];

  try {
    await new ChatGptClient(dependencies).moveConversations(
      ["conversation-1", "conversation-2"],
      "g-p-destino",
      (progress) => reports.push(progress),
    );

    assert.deepEqual(
      reports.map((report) => report.done),
      [1, 2],
    );
    assert.ok(reports.every((report) => report.total === 2 && report.phase === "working"));
    assert.equal(reports[0].title, "Conversa conversation-1");
  } finally {
    fetchStub.restore();
  }
});
