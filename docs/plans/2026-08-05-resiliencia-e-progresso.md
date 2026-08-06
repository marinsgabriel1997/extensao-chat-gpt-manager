# Plano — Resiliência de rede e progresso em operações longas

Status: aprovado e executado (Fases 1–5 concluídas; validação funcional no Chrome pendente)
Data: 2026-08-05

Ajuste posterior aprovado (2026-08-06, sem plano próprio, a pedido do usuário): a validação funcional expôs que o `GET` de detalhe por item era o endpoint limitado — cada conversa custava ~60 s de espera. A revalidação que antecede mover e excluir passou a ser feita em lote, por uma passada pela listagem no momento da operação (uma requisição por página de 100 conversas), com queda para o `GET` individual quando o id não aparece na listagem ou quando a passada falha. O item F do estudo original, portanto, foi executado — sem enfraquecer a regra de que o cache local nunca decide operações.

Ajustes de implementação em relação ao plano:

- O progresso de mover/excluir é contabilizado dentro da própria operação de cada item, em vez de por um parâmetro novo em `mapConcurrent`. Com isso o evento carrega também o título da conversa em processamento, que `mapConcurrent` não conhece.
- A retentativa dos itens que falharam é mantida na closure do resultado exibido no aviso, em vez de um estado de módulo `LastFailure`. O efeito é o mesmo com menos estado global.
Escopo: itens A + B + C + D do estudo de melhorias. Não altera o escopo funcional do MVP; nenhuma funcionalidade nova é adicionada.

## Objetivo

Tornar as operações em lote confiáveis e legíveis para o usuário, corrigindo três problemas observados no código atual:

1. **Um 429 derruba o lote inteiro.** Em `scheduleRequest` (`src/integration.ts`), enquanto `rateLimitedUntil` está no futuro toda requisição enfileirada **lança erro imediatamente**. Num lote de 200 conversas, um 429 no item 12 faz os 188 restantes falharem em milissegundos com `rate_limited` — uma pausa de 60 s vira 188 falhas.
2. **Não existe retry.** `fetchJson` só refaz a chamada em 401. Qualquer 500/502/503 ou queda momentânea de rede transforma o item em falha definitiva.
3. **Operação longa parece travada.** São duas requisições por item (o `getConversation` de revalidação + PATCH/DELETE) com `MIN_REQUEST_INTERVAL_MS = 500` e concorrência 1: ~1 s por conversa, ~3 min para 200 itens, com o rótulo estático `"Movendo 200 conversa(s)…"` e sem contador.

## Não faz parte deste plano

- Cancelamento de operação em andamento (exigiria um novo status no domínio — contrato a aprovar em separado).
- Remoção do `getConversation` de revalidação por item (é a garantia da regra "excluir somente conversas fora de projeto").
- Pacing adaptativo / aumento de concorrência.
- Persistir progresso para sobreviver ao fechamento do painel ou à suspensão do service worker.

## Decisões técnicas

1. Retry e espera de rate limit vivem **inteiramente dentro da camada de integração**. Domínio, seleção, UI e os contratos de `MoveBatchResult`/`DeleteBatchResult` permanecem inalterados.
2. Progresso é um **evento do worker para o painel**, não um novo request. O painel continua aguardando a resposta única de `move`/`delete`; os eventos só atualizam o rótulo. Se o painel estiver fechado, o envio falha silenciosamente e a operação segue.
3. Tempo e aleatoriedade são **injetados** no `ChatGptClient` para que os testes de backoff sejam determinísticos e instantâneos.
4. Nenhuma dependência de runtime nova.

## Fase 1 — Esperar o limite em vez de falhar (item A)

Arquivos: `src/integration.ts`, `tests/integration.test.js`.

- Nova constante `MAX_RATE_LIMIT_WAIT_MS = 120_000`.
- Em `scheduleRequest`, substituir o `throw` atual por espera:
  - se `Date.now() < this.rateLimitedUntil`, calcular `waitMs = this.rateLimitedUntil - now`;
  - se `waitMs <= MAX_RATE_LIMIT_WAIT_MS`, aguardar e prosseguir com a requisição;
  - se `waitMs > MAX_RATE_LIMIT_WAIT_MS`, aí sim lançar `IntegrationError(…, 429)` — um bloqueio longo demais não pode congelar a extensão.
- A espera acontece **dentro da fila serial** (`requestQueue`), que é o comportamento desejado: o lote inteiro pausa e retoma junto, sem estourar o limite de novo.
- `rateLimitEnd` já lê `Retry-After` (segundos ou data HTTP) com fallback de 60 s; permanece como está.
- Enquanto espera, emitir progresso de fase `waiting` (Fase 3) para o usuário entender a pausa.
- Log: trocar `rate_limit_activated` por um par `rate_limit_wait_started` / `rate_limit_wait_finished` com a duração.

Testes:

- 429 seguido de sucesso: a segunda requisição acontece após a espera e o item termina com `success` (com `sleep` injetado, sem tempo real).
- `Retry-After` maior que o teto: falha imediata com status 429, sem espera real.

## Fase 2 — Retry com backoff exponencial e jitter (item B)

Arquivos: `src/integration.ts`, `tests/integration.test.js`, `docs/chatgpt-integration.md`.

Constantes:

```ts
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;   // 1s → 2s → 4s
const RETRY_JITTER_RATIO = 0.25;     // ±25%
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
```

Comportamento em `fetchJson`:

- Envolver a requisição num laço de até `MAX_ATTEMPTS` tentativas.
- **Retentar**: erros de rede (o `fetch` rejeita) e os status de `RETRYABLE_STATUSES`.
- **Nunca retentar**: 400, 403, 404 e demais 4xx — são determinísticos e só gerariam ruído e atraso.
- O tratamento de **401 continua separado** do backoff: invalidar `accessToken`, renovar e refazer uma vez (comportamento atual preservado). Se o 401 persistir, falha sem retry.
- Delay entre tentativas: `RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)`, multiplicado por um fator de jitter em `[1 - RETRY_JITTER_RATIO, 1 + RETRY_JITTER_RATIO]`. **O jitter não é cosmético**: sem ele, itens de um mesmo lote sincronizam as retentativas e reincidem no 429 em bloco.
- Em 429, o `rateLimitedUntil` continua sendo atualizado; a espera efetiva fica a cargo da Fase 1 (a próxima tentativa aguarda a janela ao entrar em `scheduleRequest`), então o delay de backoff e a janela de rate limit não se somam de forma redundante — vale o maior.
- Esgotadas as tentativas, lançar o `IntegrationError` da última resposta; `failureReason` já traduz o status para `OperationFailureReason` e o item termina como `failure`, como hoje.

### Idempotência (obrigatório junto do retry)

Sem isto, o retry cria falsos negativos: uma exclusão que deu certo mas cuja resposta se perdeu seria reportada como falha.

- `deleteConversations`: quando a chamada DELETE responde **404 em uma retentativa** (`attempt > 1`), tratar como `success` — a conversa não existe mais, que é o objetivo. No 404 da **primeira** tentativa, manter `failure/not_found`, porque aí o id provavelmente veio de cache desatualizado e essa informação é útil.
- `moveConversations`: o PATCH com `gizmo_id` é naturalmente idempotente; repetir é seguro e nenhum tratamento especial é necessário.
- A revalidação por item (`getConversation`) permanece obrigatória e acontece **antes** do laço de retry da operação em si.

### Injeção de tempo e aleatoriedade

`ChatGptClient` passa a aceitar dependências opcionais no construtor, com os valores reais como padrão:

```ts
interface ClientDependencies {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}
```

Todo `Date.now()`, `setTimeout` e jitter da classe passam a usar essas funções. Nenhum chamador existente muda (`new ChatGptClient()` continua válido).

Testes:

- 503 → 503 → 200 termina em sucesso, com exatamente 3 tentativas e delays registrados em `[1000, 2000]` antes do jitter.
- 404 não é retentado (uma única tentativa).
- Falha de rede (fetch rejeitando) é retentada.
- Esgotar as tentativas produz `failure` com o `reason` correto.
- DELETE que responde 404 na segunda tentativa vira `success`; 404 na primeira permanece `failure/not_found`.
- Jitter dentro da faixa esperada com `random` injetado nos extremos (0 e 1).

## Fase 3 — Progresso real em lote (item C)

Arquivos: `src/messages.ts`, `src/integration.ts`, `src/service-worker.ts`, `src/sidepanel.ts`.

Novo canal de evento, separado do union de requests para não afetar a exaustividade do `switch` de `handleRequest`:

```ts
export type ExtensionEvent = {
  type: "operation-progress";
  operation: "move" | "delete" | "inventory";
  phase: "working" | "waiting";   // "waiting" = pausa por rate limit
  done: number;
  total: number;                  // 0 quando o total é desconhecido (paginação)
  title: string | null;           // título da conversa em processamento, quando houver
};
```

- `mapConcurrent` ganha um parâmetro opcional `onProgress(done, total)`, chamado **após** cada item concluído (contador incrementado sob a mesma serialização já existente).
- `moveConversations`, `deleteConversations` e `listAllConversations` aceitam um callback opcional de progresso; a integração **não conhece `chrome`** — quem envia a mensagem é o service worker, que passa o callback. Isso preserva o isolamento da camada.
- O service worker envia com `chrome.runtime.sendMessage(event)` e ignora a rejeição (painel fechado é situação normal, não erro).
- O painel registra um `chrome.runtime.onMessage` que atualiza o rótulo via `setConnection`:
  - `working`: `"Movendo 47 de 200…"`;
  - `waiting`: `"Aguardando o limite do ChatGPT…"`;
  - `inventory` sem total: `"Carregando conversas… (300)"`.
- O listener só atualiza o texto quando `busy === true`, para não sobrescrever `"Pronto"` por um evento atrasado.
- Frequência: um evento por item concluído. Em lotes de centenas de itens isso é irrelevante em custo e o intervalo mínimo de 500 ms já limita a taxa naturalmente.

Testes: `mapConcurrent` reporta progresso na ordem de conclusão e chega exatamente a `total`. O envio via `chrome.runtime` é verificado apenas na validação funcional (não há infraestrutura de teste para as APIs do Chrome no projeto).

## Fase 4 — Tentar novamente os itens que falharam (item D)

Arquivo: `src/sidepanel.ts` (e `sidepanel.html` se um botão dedicado for necessário).

O estado atual já ajuda: `applyMoveResult` e `applyDeleteResult` removem da seleção apenas os itens `success`/`skipped`, então **os itens que falharam continuam selecionados**. Falta apenas tornar isso explícito e acionável.

- Guardar o resultado da última operação em estado de módulo:

```ts
type LastFailure =
  | { kind: "move"; ids: string[]; destinationProjectId: string }
  | { kind: "delete"; ids: string[] }
  | null;
```

- Quando `failedCount > 0`, exibir no aviso um botão `Tentar novamente (n)` que reexecuta o mesmo fluxo apenas com os ids que falharam.
- A retentativa de exclusão **mantém a confirmação** — nenhum atalho para operação destrutiva.
- A retentativa reusa `moveSelected`/`deleteSelected` extraindo o corpo em funções que recebem os ids explicitamente (`runMove(ids, destination)` / `runDelete(ids)`), sem duplicar a lógica de resultado.
- Concluída uma operação sem falhas, o botão desaparece e `lastFailure` volta a `null`.
- Nada aqui interpreta seleção vazia como "todas": se a lista de ids da retentativa estiver vazia, o botão não existe.

## Fase 5 — Documentação

- `docs/chatgpt-integration.md`: registrar a política observada e adotada — status retentáveis, leitura de `Retry-After`, teto de espera, e a semântica do 404 em retentativa de DELETE.
- `docs/architecture.md`: nova seção curta sobre resiliência (fila serial + espera de rate limit + backoff) e sobre o canal de eventos de progresso worker → painel.
- `docs/requirements.md`: requisito não funcional de feedback de progresso e de tolerância a falhas transitórias.
- `CLAUDE.md` / `AGENTS.md`: **sem alteração** — este plano não muda escopo, contratos de domínio nem políticas normativas.

## Validação

- `npm run check` (build TypeScript + `node --test`), incluindo os testes novos das Fases 1–3.
- Todos os testes de tempo usam `sleep`/`now`/`random` injetados: a suíte continua rodando em milissegundos.
- Validação funcional no Chrome com sessão real (o comportamento de 429 só se observa no ambiente real):
  1. lote de ~30 conversas: contador avança e o rótulo reflete o item atual;
  2. forçar rate limit com um lote grande: a operação **pausa e retoma**, sem cascata de falhas, e o rótulo mostra a espera;
  3. desconectar a rede no meio de um lote: itens em curso são retentados; ao esgotar, falham individualmente e o restante do lote continua;
  4. "Tentar novamente" após falhas parciais reprocessa exatamente os itens que falharam;
  5. fechar o painel durante um lote não derruba a operação nem gera erro no worker;
  6. fluxos existentes (busca, listagem, mover, excluir, cache) permanecem intactos.

## Critérios de aceite

1. Um 429 no meio de um lote faz o lote **esperar e continuar**; os itens seguintes não falham em cascata. Acima do teto de espera, falha explícita e informativa.
2. Erros transitórios (rede, 5xx, 429) são retentados até 3 vezes com backoff exponencial e jitter; 4xx determinísticos não são retentados.
3. Uma exclusão confirmada pelo servidor nunca é reportada como falha por causa de uma retentativa (404 em retentativa = sucesso).
4. Durante move, delete e carga da listagem, o painel mostra progresso numérico que avança, e indica quando está aguardando o limite do ChatGPT.
5. Após falha parcial, é possível reprocessar só os itens que falharam, com confirmação preservada na exclusão.
6. Contratos de `MoveBatchResult`/`DeleteBatchResult` e todo o domínio permanecem inalterados; falha parcial continua nunca sendo reportada como sucesso total.
7. `npm run check` passa e a suíte não depende de tempo real.
8. Nenhuma dependência de runtime nova.

## Riscos

- **Lote muito mais lento sob rate limit persistente**: com espera + retry, um lote grande pode levar vários minutos. Mitigado pelo teto de espera, pelo limite de 3 tentativas e pelo progresso visível. O cancelamento (item E do estudo) é a mitigação completa e fica para uma entrega seguinte.
- **Retry mascarando um erro real de contrato**: mitigado por não retentar 4xx determinísticos e por manter o log de `request_failed` em cada tentativa, com o número da tentativa.
- **Evento de progresso chegando após o fim da operação**: mitigado pela guarda `busy === true` no listener do painel.
- **Service worker MV3 suspenso em lote longo**: fora do escopo deste plano; as requisições em andamento mantêm o worker vivo, mas fechar o painel ainda descarta o resultado final. Registrado como limitação conhecida.
- **Progresso acoplando a integração ao Chrome**: evitado por contrato — a integração recebe um callback puro; só o service worker fala com `chrome.runtime`.
