# Plano — Organização por pastas, arrastar para Projetos, contexto e seleção rápida

Status: aprovado em 2026-10-04 e executado (Fases 0–6 concluídas; validação funcional no Chrome pendente)
Data: 2026-10-03
Decisões aprovadas junto com o plano: conversas em Projeto seguem não selecionáveis/arrastáveis; sem "Desfazer"; soltar sobre uma pasta move sem confirmação; as duas abas são substituídas pela tela única.
Origem: pedido do usuário para melhorar a organização das conversas (itens 1, 2, 3 e 4 da proposta de 2026-10-03). Ordenação/filtros por data e agrupamento por mês (item 5) ficam para entrega posterior.

## Objetivo

Substituir as abas "Buscar e mover" e "Listar e excluir" por uma tela única de organização, construída sobre a listagem completa em cache, em que o usuário:

1. navega por "pastas" (Sem projeto, Todas e cada Projeto, com contagem);
2. move conversas selecionadas para um Projeto arrastando-as até a pasta ou pelo botão "Mover para…";
3. vê contexto suficiente para decidir sem abrir a conversa (primeira mensagem, início da última resposta, datas);
4. seleciona rapidamente (Shift+clique por intervalo, selecionar visíveis, contador sempre visível).

## Escopo

Incluído:

- tela única "Organizar" com painel de pastas, busca, lista e barra de ações;
- busca em dois modos: **Título** (local, sobre o cache) e **Conteúdo** (pesquisa do ChatGPT, com trecho correspondente);
- arrastar e soltar conversas selecionadas sobre uma pasta de Projeto, e "Mover para…" como alternativa acessível;
- linha expansível com primeira mensagem do usuário, início da última resposta do assistente, datas de criação e atualização e botão de abrir no ChatGPT;
- seleção por intervalo com Shift+clique, "Selecionar visíveis", `Esc` para limpar e barra de seleção fixa.

Fora do escopo desta entrega (sem mudança nas decisões vigentes):

- mover conversas que já estão em um Projeto (de Projeto para Projeto) ou removê-las de um Projeto — o fluxo de mover continua ignorando conversas em Projeto (`already_in_project`);
- "Desfazer" após mover — depende de remover conversa de Projeto, que não foi observado e está fora do escopo;
- excluir conversas em Projeto; arquivar; criar/renomear Projetos;
- ordenação, filtro por período e agrupamento por mês (item 5);
- pré-carregar detalhes de todas as conversas.

Não exige alteração de `CLAUDE.md`/`AGENTS.md`: os recursos refinam itens já presentes no escopo funcional (filtrar, selecionar, listar Projetos, mover, listar todas as conversas).

## Decisões de produto

1. **Uma tela, não duas abas.** A listagem completa (inventário em cache) é a base. Sem inventário carregado, a tela mostra o estado vazio com "Carregar conversas" (abrir o painel continua sem disparar chamadas).
2. **Pastas** (ordem fixa): `Sem projeto (N)`, `Todas (N)`, separador, Projetos em ordem alfabética com contagem. Projetos sem conversas aparecem com `0`. A pasta padrão é `Sem projeto`. O chip "Em projeto" deixa de existir (substituído pelas pastas individuais).
3. **Conversas em Projeto** aparecem nas pastas `Todas` e na pasta do Projeto, com o nome do Projeto, mas continuam não selecionáveis, não arrastáveis e não excluíveis.
4. **Arrastar:** arrastar uma linha selecionada leva a seleção inteira (inclusive itens selecionados fora da pasta visível; a imagem de arraste mostra "Mover N conversa(s)"). Arrastar uma linha não selecionada leva só ela e não altera a seleção. Soltar sobre um Projeto executa a movimentação imediatamente, sem diálogo de confirmação — mover não é destrutivo. Durante o arraste, a pasta sob o cursor destaca e exibe "Mover N para «Projeto»". `Sem projeto` e `Todas` não aceitam soltura.
5. **Mover para…** na barra de ações abre uma lista de Projetos filtrável por texto; é o caminho por teclado e o principal em telas estreitas.
6. **Contexto sob demanda.** O detalhe só é buscado quando o usuário expande a linha. O resultado fica em memória durante a vida do painel, nunca em `chrome.storage` (o cache persistente segue restrito a metadados).
7. **Busca por conteúdo** cruza os resultados com o inventário pelo identificador para obter Projeto e datas, e respeita a pasta ativa. Resultados ausentes do inventário (conversas novas desde a última coleta) aparecem com o aviso "não está na listagem local — atualize" e não são selecionáveis até a próxima coleta.
8. **Exclusão** permanece como hoje: somente conversas fora de projeto, seleção explícita, confirmação.

## Layout (Side Panel, ~360–500 px)

```text
┌ ChatGPT Manager                         ● Pronto ┐
│ [ Buscar…                        ] [Título|Conteúdo]
│ ▾ Pastas
│   Sem projeto ........................ 212  ◀ ativa
│   Todas .............................. 334
│   ─────────────
│   LIXEIRA .............................. 40
│   Trabalho ............................. 30
│ 212 conversas · Atualizado há 2 min · Atualizar   Selecionar visíveis
│ ☐ Explicação do Drive Compartilhado      02/10  ⌄
│ ☑ Avaliação do desumidificador EOS       02/10  ⌄
│   ┊ Você: "Quero comparar o EOS com…"
│   ┊ ChatGPT: "O EOS tem capacidade de…"
│   ┊ Criada 01/10/2026 · Atualizada 02/10/2026   Abrir ↗
│ …
├──────────────────────────────────────────────────┤
│ 3 selecionadas   [Mover para…] [Excluir] [Limpar] │  (fixa)
└──────────────────────────────────────────────────┘
```

- O painel de pastas é recolhível e fixo no topo (`position: sticky`) com altura máxima e rolagem própria; recolhido, mostra só a pasta ativa. Ao iniciar um arraste com o painel recolhido, ele expande automaticamente.
- A barra de seleção aparece sempre que houver seleção e mostra também quantas selecionadas estão fora da pasta visível ("3 selecionadas · 1 fora desta pasta").

## Fase 0 — Observação (pré-requisito, sem código de produção)

Status: CONCLUÍDA em 2026-10-04 a partir das capturas e da documentação existentes (sem nova observação no navegador). Itens 1 e 2 resolvidos: a captura de detalhe contém `assistant:text` e o anonimizador preserva o tipo dos campos de data (texto ISO na listagem geral, epoch numérico no detalhe e na pesquisa). Item 3 permanece pendente em `docs/chatgpt-integration.md` e será confirmado na validação funcional.

Registrar em `docs/chatgpt-integration.md`:

1. **Última resposta do assistente** no detalhe: confirmar, a partir da captura existente (`docs/conversation-detail-response.example.json` tem `assistant:text`, `assistant:thoughts`, `assistant:reasoning_recap`, `assistant:model_editable_context`) e de uma conversa real com ferramentas/imagens, que o texto visível é `author.role = "assistant"`, `content.content_type = "text"` e `parts[]`, ignorando os demais tipos e mensagens com `is_visually_hidden_from_conversation`.
2. **`create_time` / `update_time` na listagem geral:** confirmar o formato (ISO string ou epoch numérico). A captura da busca mostra `update_time` numérico (`1700000000`), que o conversor atual (`stringValue`) descarta.
3. **Rota de abertura de conversa em Projeto:** verificar se `/c/{conversation_id}` funciona para conversas de Projeto ou se é necessária outra rota.

## Fase 1 — Domínio

Arquivos: `src/domain.ts`, `docs/domain-contracts.md`, `tests/domain.test.js`.

- `Conversation` ganha `createdAt: string | null` (ISO 8601, convertido na fronteira).
- Pasta como conceito de domínio, substituindo `ConversationScopeFilter`:

```ts
type ConversationFolder =
  | { kind: "outside_project" }
  | { kind: "all" }
  | { kind: "project"; projectId: ProjectId };

function filterByFolder(conversations, folder): Conversation[];
function countByFolder(conversations, projects): FolderCounts; // sem projeto, todas, por Projeto (inclui zeros)
```

- Filtro textual por título como função pura (hoje está na interface).
- Seleção por intervalo: `selectRange(orderedVisibleIds, anchorId, targetId, selectableIds)` devolve os ids do intervalo entre âncora e alvo, somente os selecionáveis, na ordem visível.
- Conjunto arrastado: `dragSet(draggedId, selectedIds)` → seleção inteira se o item estiver selecionado, senão `[draggedId]`.
- Contexto da conversa:

```ts
interface ConversationContext {
  conversationId: ConversationId;
  firstUserMessage: string;       // "" quando não houver
  lastAssistantMessage: string;   // "" quando não houver
}
```

## Fase 2 — Integração

Arquivos: `src/integration.ts`, `tests/integration.test.js`.

- `conversationFromPayload`: preencher `createdAt` e normalizar `update_time`/`create_time` conforme a Fase 0 (aceitar epoch numérico, convertendo para ISO).
- `getConversationContext(conversationId)`: uma chamada ao detalhe, reaproveitando o percurso do caminho ativo de `firstVisibleUserText`; nova extração `lastVisibleAssistantText`. Passa pela fila serial e pelo tratamento de rate limit existentes.
- Busca por conteúdo: `searchConversations(query)` retorna todos os resultados (identificador, título, trecho, data), **sem** consultar o índice de conversas por Projeto; o vínculo com Projeto vem do inventário no painel. O índice completo (`loadProjectsAndConversationIndex` / `loadRemainingProjectConversationIds`) deixa de ser usado e é removido, reduzindo requisições.
- Testes com a captura anonimizada de detalhe (primeira mensagem do usuário, última do assistante, ignorando `thoughts`/`reasoning_recap`/ocultas) e com itens de listagem com datas nos dois formatos.

## Fase 3 — Cache persistente

Arquivos: `src/conversation-store.ts`, `tests/conversation-store.test.js`.

- Snapshot passa a guardar `createdAt`. Versão sobe para 2; snapshot v1 continua legível, com `createdAt: null`, para não forçar nova coleta.
- O contexto expandido (mensagens) **não** é persistido.

## Fase 4 — Mensagens e service worker

Arquivos: `src/messages.ts`, `src/service-worker.ts`.

- Novo request `{ type: "get-conversation-context"; conversationId }` → `ConversationContext`.
- `search` passa a responder com os resultados brutos convertidos (sem filtragem por Projeto).
- `open-conversation` ajustado conforme a Fase 0, se a rota de conversas em Projeto for diferente.

## Fase 5 — Interface

Arquivos: `sidepanel.html`, `src/sidepanel.ts`.

- Remover as abas e montar a tela única (layout acima). Estado da seleção único (hoje há `selectedIds` e `allSelectedIds`).
- Painel de pastas com contagens derivadas de `countByFolder`; clique troca a pasta ativa sem descartar a seleção.
- Campo de busca com alternância Título/Conteúdo. Conteúdo exige Enter/botão e mostra o trecho na linha; o `SearchSessionCache` continua guardando resultados por query.
- Arrastar e soltar com a API nativa de Drag and Drop (`draggable`, `dragstart`, `dragover`, `drop`); linhas não selecionáveis não são arrastáveis. Soltar chama o mesmo fluxo de `move` existente, com progresso, resultado separado (sucesso/ignorado/falha) e "Tentar novamente" para falhas.
- "Mover para…": lista de Projetos com campo de filtro, abrindo sobre a barra de ações.
- Linha expansível (`⌄`): busca o contexto uma vez, mostra "Carregando…", trata erro com "Tentar novamente"; texto limitado a ~4 linhas por mensagem; datas e "Abrir ↗".
- Seleção: Shift+clique usa `selectRange` a partir do último item clicado; `Esc` limpa a seleção (sem confirmação, pois não executa operação); "Selecionar visíveis" mantém o comportamento atual.
- Após mover ou excluir, pastas e contagens atualizam a partir do cache sincronizado.

## Fase 6 — Documentação

- `docs/requirements.md`: atualizar RF-01/RF-03/RF-04 (busca sem índice por Projeto, cruzamento com o inventário), RF-05 (preview e abrir), RF-15/RF-16 (pastas no lugar do filtro de escopo); novos RFs para pastas, arrastar/"Mover para…", contexto expansível e seleção por intervalo; ajustar critérios de aceite.
- `docs/architecture.md`: tela única, fim do índice de conversas por Projeto na busca, contexto em memória.
- `docs/domain-contracts.md`: contratos da Fase 1.
- `docs/chatgpt-integration.md`: resultados da Fase 0.

## Validação

- `npm run check` (build + testes unitários): pastas e contagens, filtro textual, `selectRange`, `dragSet`, conversão de datas, extração de contexto a partir da captura, leitura de snapshot v1 e v2.
- Validação funcional no Chrome com sessão real:
  - carregar o inventário, navegar pelas pastas e conferir contagens com o ChatGPT;
  - arrastar 1 item não selecionado e uma seleção de vários itens (incluindo item fora da pasta visível) para um Projeto; conferir contagens e cache;
  - "Mover para…" só com teclado;
  - expandir conversas comuns, com ferramentas/imagens e de Projeto; abrir no ChatGPT;
  - busca por conteúdo com resultados dentro e fora de Projetos, e com conversa nova ainda fora do inventário;
  - Shift+clique em ambas as direções e após trocar de pasta;
  - exclusão continua restrita e com confirmação.

## Critérios de aceite

1. Uma única tela apresenta as pastas Sem projeto, Todas e cada Projeto, com contagens coerentes com o inventário.
2. Clicar em `Sem projeto` lista todas as conversas fora de projeto sem precisar digitar consulta.
3. Arrastar uma conversa selecionada para um Projeto move a seleção inteira; arrastar uma não selecionada move só ela; o resultado separa sucesso, ignorados e falhas.
4. "Mover para…" permite a mesma operação sem arrastar, inclusive por teclado.
5. Conversas em Projeto não são selecionáveis, arrastáveis nem excluíveis.
6. Expandir uma linha mostra a primeira mensagem do usuário, o início da última resposta, as datas e o botão de abrir, com uma única chamada por conversa por sessão do painel; nenhum conteúdo de mensagem é persistido.
7. A busca por conteúdo mostra o trecho, respeita a pasta ativa e sinaliza resultados ausentes do inventário.
8. Shift+clique seleciona o intervalo visível; trocar de pasta e atualizar o inventário não descartam a seleção silenciosamente; a barra mostra o total real selecionado.
9. Exclusão permanece restrita a conversas fora de projeto, com seleção explícita e confirmação.
10. Abrir o painel não dispara chamadas ao ChatGPT.

## Riscos

- **Drag and drop em painel estreito** é impreciso — mitigado por "Mover para…", painel de pastas fixo e destaque claro do alvo.
- **Soltura acidental no Projeto errado** sem "Desfazer" — mitigado pelo rótulo "Mover N para «Projeto»" durante o arraste e pela ausência de soltura em `Sem projeto`/`Todas`; corrigir exige mover manualmente no ChatGPT. Se isso se mostrar frequente, reavaliar confirmação ou observar a remoção de Projeto em nova decisão.
- **Rate limit no endpoint de detalhe** ao expandir muitas linhas seguidas — mitigado pela fila serial, espera de rate limit existente e cache em memória.
- **Remoção do índice por Projeto** muda a busca: sem inventário carregado não há como indicar o Projeto dos resultados — mitigado por exigir o inventário como base da tela.
- **Formato das mensagens do assistente** varia (ferramentas, imagens, raciocínio) — mitigado pela Fase 0 e por exibir vazio quando não houver texto visível.
- **Contratos internos instáveis** — isolados na camada de integração, documentados em `docs/chatgpt-integration.md`.
