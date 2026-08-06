# Plano — Aba "Todas as conversas" e cache local persistente

Status: aprovado e executado (Fases 0–6 concluídas; validação funcional no Chrome pendente)
Data: 2026-08-05
Decisões complementares aprovadas: aba lista somente conversas não arquivadas; carregamento da listagem é manual (botão), abrir a aba lê apenas o cache local; `limit=100` validado na listagem geral; abrir o painel não dispara nenhuma chamada (botão "Carregar projetos" na aba de busca); abas renomeadas para "Buscar e mover" e "Listar e excluir".

## Objetivo

Adicionar uma segunda aba ao Side Panel que lista todas as conversas do usuário, indica onde cada uma está (Projeto ou fora de projeto) e permite excluir rapidamente conversas fora de projeto. Introduzir cache local persistente (`chrome.storage.local`) para que a aba carregue instantaneamente em aberturas seguintes.

## Mudança de escopo do MVP

Este plano altera uma decisão registrada: exclusão em massa passa a fazer parte do escopo, por decisão explícita do usuário (2026-08-05), com o seguinte recorte:

- exclusão sempre a partir de seleção explícita e não vazia (individual ou em lote);
- somente conversas fora de projeto são excluíveis pela extensão;
- confirmação simples antes de excluir, informando a quantidade;
- a exclusão usa o mecanismo do próprio ChatGPT (a ser observado), sem comportamento especial.

Ao aprovar este plano, atualizar `CLAUDE.md`, `AGENTS.md` (sincronização normativa) e `docs/requirements.md` (remover "excluir conversas em massa" de "Fora do escopo" e registrar os novos requisitos).

## Decisões de produto

1. Aba nova "Todas" ao lado da atual "Organizar"; o fluxo atual não muda.
2. Filtros da aba: `Fora de projeto` (padrão), `Em projeto`, `Todas`, mais filtro textual por título (client-side, sobre os dados carregados).
3. Conversas em projeto aparecem na lista (com badge do Projeto) para dar contexto, mas sem checkbox e sem ação de exclusão.
4. Exclusão individual (ícone por linha) e em lote (barra fixa no rodapé com contagem e botão "Excluir (n)").
5. Cache stale-while-revalidate: renderiza imediatamente o que está em `chrome.storage.local`, indica a idade dos dados e atualiza em segundo plano.

## Fase 0 — Observação (pré-requisito, sem código de produção)

Status: CONCLUÍDA em 2026-08-05. Resultados registrados em `docs/chatgpt-integration.md`:

1. **Exclusão de conversa**: `DELETE /backend-api/conversation/id/{conversation_id}` (rota com segmento literal `/id/`, diferente do PATCH de mover), body vazio, resposta `{"success": true}`.
2. **Listagem geral**: `GET /backend-api/conversations` com `offset`/`limit`; sem `hide_snorlax`, conversas de Projetos vêm com `gizmo_id: "g-p-..."` no item. `total` não é contagem real (`offset + limit + 1` observado); fim de paginação por página incompleta. `snippet` veio `null` na listagem (sem preview na aba).

Pendências registradas que não bloqueiam a implementação: headers mínimos do DELETE (validar na prática que só `Authorization` basta, como nas demais chamadas), recuperabilidade da exclusão e semântica exata de `hide_snorlax` (não utilizado pela extensão).

## Fase 1 — Domínio

Arquivos: `src/domain.ts`, `docs/domain-contracts.md`, `tests/domain.test.js`.

- Estender `Conversation` com `updatedAt: string | null` (ISO 8601; a integração converte o formato cru na fronteira). `preview` permanece; a listagem geral pode preenchê-lo com `snippet` vazio ou ausente.
- Novo conceito de filtro da listagem: `type ConversationScopeFilter = "outside_project" | "in_project" | "all"` e função pura `filterByScope(conversations, filter)`.
- Comando e resultados de exclusão, espelhando o padrão de movimentação:
  - `createDeleteCommand(conversationIds)` — valida seleção não vazia, ids únicos e não vazios;
  - `DeleteItemResult = success | skipped (reason: "in_project") | failure (DeleteFailureReason)`;
  - `DeleteBatchResult { items }` — um resultado por id recebido; falha parcial nunca vira sucesso total.
  - `DeleteFailureReason` reutiliza o mesmo conjunto de `MoveFailureReason` (renomear para `OperationFailureReason` compartilhado, mantendo alias para não quebrar contratos existentes).
- Regras de seleção da aba: mesma semântica de `ConversationSelection` (seleção explícita, vazia = nenhuma), porém vinculada à aba e ao filtro ativo; mudar filtro não descarta a seleção silenciosamente — itens selecionados que saem do filtro visível permanecem selecionados e a barra do rodapé reflete o total real.

## Fase 2 — Integração

Arquivos: `src/integration.ts`, `tests/integration.test.js`.

- `listAllConversations()`: pagina `GET /backend-api/conversations` por `offset`/`limit`, sem o parâmetro `hide_snorlax` (observado: sem ele, conversas de Projetos vêm na listagem com o id do Projeto em `gizmo_id`). Encerra a paginação quando uma página retorna menos itens que `limit` — o campo `total` da resposta não é contagem real (observado como `offset + limit + 1`) e não deve ser usado. Converte itens na fronteira para `Conversation`, resolvendo `projectId` pelo prefixo `g-p-` (lógica `projectIdFromPayload` já existente), e deduplica por id. Respeita o `scheduleRequest` atual (intervalo mínimo de 500 ms, sem retry em 429). O índice da sidebar não é necessário para esta listagem; `listProjects()` segue sendo usado apenas para obter os nomes dos Projetos.
- `deleteConversations(conversationIds)`: concorrência 1, e para cada item:
  1. revalida com `getConversation(id)`; se `projectId !== null`, retorna `skipped (in_project)` sem chamar exclusão;
  2. executa a chamada de exclusão observada na Fase 0;
  3. traduz erros HTTP para `DeleteFailureReason` (mesma tabela de `failureReason`).
- Nada dos formatos crus atravessa a fronteira; parsing segue o padrão `isObject`/`stringValue` atual.

## Fase 3 — Cache persistente

Arquivo novo: `src/conversation-store.ts` (nome sujeito ao vocabulário existente), `tests/conversation-store.test.js`.

- Armazenamento em `chrome.storage.local`, chave única versionada:

```ts
interface ConversationCacheV1 {
  version: 1;
  fetchedAt: string;            // ISO 8601
  conversations: Conversation[]; // somente metadados (id, title, updatedAt, projectId; preview vazio)
  projects: Project[];
}
```

- Leitura na abertura da aba: se existir cache válido (versão compatível), renderizar imediatamente com indicador "atualizado há X"; disparar refresh em segundo plano em seguida.
- Escrita: ao concluir um refresh completo com sucesso. Refresh parcial ou com falha não sobrescreve o cache anterior.
- Mutações locais mantêm o cache coerente sem esperar novo refresh:
  - mover conversas → atualizar `projectId` dos itens afetados;
  - excluir conversas → remover itens com `status: "success"` (falhas e ignorados permanecem);
  - manter a integração do `SearchSessionCache.removeConversations` existente para a aba de busca.
- Reconciliação após refresh: substituir a lista, preservando a seleção manual por interseção de ids (ids selecionados que deixaram de existir saem da seleção e são reportados na contagem, nunca descartados silenciosamente sem reflexo na UI).
- O cache nunca é fonte de verdade para operações: mover e excluir continuam revalidando o estado atual por item antes de agir.
- Sem dados sensíveis: nenhum token ou header é persistido; somente metadados de conversa/Projeto.
- Cache inválido/corrompido ou de versão desconhecida é descartado e recriado.

Manifest: adicionar permissão `storage` em `manifest.json`.

## Fase 4 — Mensagens e service worker

Arquivos: `src/messages.ts`, `src/service-worker.ts`.

Novos requests:

- `{ type: "list-all-conversations"; refresh: boolean }` → `{ conversations, projects, fetchedAt, fromCache: boolean }`;
- `{ type: "delete"; conversationIds: string[] }` → `DeleteBatchResult`.

O service worker orquestra cache + integração (o cache vive no contexto do worker via `chrome.storage`, então sobrevive à suspensão do worker e ao fechamento do painel).

## Fase 5 — Interface

Arquivos: `sidepanel.html`, `src/sidepanel.ts`.

- Abas "Organizar" / "Todas" no header, conforme wireframe aprovado; trocar de aba não descarta o estado da outra.
- Aba "Todas": campo de filtro textual, chips de escopo, lista com checkbox/lixeira apenas para itens fora de projeto, badge do Projeto nos demais, contagem "N conversas · M selecionadas", "Selecionar visíveis" (age somente sobre os itens atualmente visíveis pelo filtro), barra fixa no rodapé com "Limpar" e "Excluir (n)".
- Indicador de frescor do cache ("atualizado há 2h" / "atualizando…") junto à contagem.
- Confirmação antes de excluir: diálogo simples com a quantidade ("Excluir N conversas? A exclusão usa o mecanismo do próprio ChatGPT.").
- Resultado da exclusão: sucessos, ignorados (em projeto) e falhas apresentados separadamente, reutilizando o padrão visual do resultado de movimentação.
- Renderização incremental simples (a lista completa pode ter centenas de itens); sem virtualização no MVP, apenas render por blocos se necessário.

## Fase 6 — Documentação

- `docs/requirements.md`: novos RFs (listar todas, filtrar por escopo, excluir seleção com confirmação, cache persistente) e atualização de "Fora do escopo" e critérios de aceite.
- `docs/architecture.md`: nova seção de cache persistente e fluxo de exclusão.
- `docs/domain-contracts.md`: novos contratos da Fase 1.
- `docs/chatgpt-integration.md`: atualizado na Fase 0.
- `CLAUDE.md` + `AGENTS.md`: escopo funcional atualizado (exclusão a partir de seleção explícita, restrita a conversas fora de projeto).

## Validação

- `npm test` (unitários): domínio (filtros, comando de exclusão, consolidação), conversões da integração com payloads representativos capturados, store de cache (leitura, escrita, reconciliação, mutações, versão inválida).
- Build TypeScript e lint oficiais do projeto.
- Validação funcional no Chrome com sessão real: carregar aba com cache frio e quente, excluir 1 conversa fora de projeto, tentar excluir conversa que entrou em projeto por fora (deve ser ignorada), verificar falha parcial, verificar que mover conversas atualiza a aba "Todas".

## Critérios de aceite

1. A aba "Todas" lista todas as conversas com indicação de Projeto ou "Sem projeto".
2. Com cache quente, a lista aparece imediatamente ao abrir o painel, com idade dos dados visível, e atualiza em segundo plano.
3. Filtros de escopo e filtro textual funcionam sobre os dados carregados sem novas chamadas.
4. Somente conversas fora de projeto são selecionáveis/excluíveis; a exclusão exige confirmação e seleção explícita.
5. Cada item excluído tem resultado determinável; falhas parciais e ignorados são exibidos separadamente e nunca reportados como sucesso total.
6. Mover ou excluir atualiza o cache local; seleção manual sobrevive a refresh e troca de filtro.
7. Nenhum token ou dado de autenticação é persistido.
8. Fluxos existentes (busca, seleção, mover) permanecem intactos.

## Riscos

- **Endpoint de exclusão diferente da hipótese** — mitigado pela Fase 0 como pré-requisito bloqueante.
- **Exclusão é destrutiva no ChatGPT** (possivelmente sem lixeira recuperável) — mitigado por confirmação, revalidação por item e restrição a conversas fora de projeto.
- **Volume de conversas grande** (centenas/milhares): primeira carga pode ser lenta pelo intervalo de 500 ms entre requisições — mitigado pelo cache persistente e por `limit` alto se a Fase 0 confirmar suporte; comunicar progresso durante a primeira carga.
- **Contrato interno instável**: mudanças no `/backend-api/conversations` quebram a listagem — isolamento na camada de integração e doc canônica minimizam o custo de correção.
- **Cache desatualizado**: nunca usado como verdade para operações; revalidação por item permanece obrigatória.
