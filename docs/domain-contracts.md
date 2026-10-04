# Contratos de domínio

Este documento define os conceitos usados pelo núcleo da aplicação. Formatos crus, endpoints e campos específicos da aplicação web do ChatGPT pertencem exclusivamente à camada de integração.

## Identificadores

```ts
type ConversationId = string;
type ProjectId = string;
```

Identificadores devem ser não vazios. A camada de integração é responsável por extrair o identificador correto de cada payload observado.

## Conversation

```ts
interface Conversation {
  id: ConversationId;
  title: string;
  preview: string;
  projectId: ProjectId | null;
  createdAt: string | null;
  updatedAt: string | null;
}
```

Representa uma conversa disponível para apresentação e seleção. `preview` contém a primeira mensagem textual visível do usuário quando a integração fornece o detalhe, ou uma string vazia. `createdAt` e `updatedAt` contêm datas em ISO 8601, ou `null` quando a integração não fornecer o dado; a conversão de formatos crus acontece na fronteira da integração. Campos adicionais da integração não integram automaticamente o domínio.

Uma conversa é selecionável, arrastável e excluível somente quando `projectId` é `null`. Conversas de GPTs customizados não possuem vínculo com Projeto e mantêm `projectId` nulo.

## ConversationFolder

```ts
type ConversationFolder =
  | { kind: "outside_project" }
  | { kind: "all" }
  | { kind: "project"; projectId: ProjectId };

interface FolderCounts {
  outsideProject: number;
  all: number;
  byProject: Map<ProjectId, number>;
}
```

Pasta da tela de organização. "Pasta" é o vocabulário da interface; cada Projeto do ChatGPT é uma pasta, e `outside_project` e `all` são pastas virtuais. Funções puras:

- `filterByFolder(conversations, folder)` aplica a pasta sem alterar a coleção original;
- `countByFolder(conversations, projects)` conta conversas por pasta, incluindo Projetos sem conversas (zero) e Projetos referenciados por conversas mas ausentes da lista de Projetos;
- `filterByTitle(conversations, query)` filtra por título sem distinção entre maiúsculas e minúsculas; consulta vazia não filtra.

Trocar de pasta ou de filtro nunca altera a seleção.

## ConversationSearchHit

```ts
interface ConversationSearchHit {
  id: ConversationId;
  title: string;
  snippet: string;
  updatedAt: string | null;
}
```

Resultado da pesquisa por conteúdo. A pesquisa não informa o vínculo com Projeto: ele é resolvido pelo identificador contra a listagem completa. Resultados ausentes da listagem não são selecionáveis até uma nova coleta.

## ConversationContext

```ts
interface ConversationContext {
  conversationId: ConversationId;
  firstUserMessage: string;
  lastAssistantMessage: string;
}
```

Contexto exibido ao expandir uma conversa: primeira mensagem textual visível do usuário e última resposta textual visível do assistente no caminho ativo, ou strings vazias. O contexto existe somente em memória durante a vida do painel e nunca é persistido.

## Project

```ts
interface Project {
  id: ProjectId;
  name: string;
}
```

Representa um Projeto existente e acessível ao usuário. `LIXEIRA` é apenas um possível valor de `name`.

## ConversationQuery

```ts
interface ConversationQuery {
  text: string;
}
```

`text` contém a consulta textual informada pelo usuário. Uma nova consulta inicia um novo conjunto de resultados e uma nova seleção.

## Página de resultados

```ts
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

`nextCursor` igual a `null` indica o fim da paginação. Cursores são mecanismos de continuação e não identificadores de itens.

## ConversationSelection

A seleção é um conjunto explícito de `ConversationId` mantido pela tela de organização.

Regras:

- cada identificador aparece no máximo uma vez;
- somente conversas fora de projeto podem ser selecionadas;
- seleção vazia representa nenhuma conversa;
- "selecionar visíveis" adiciona os identificadores selecionáveis da visão atual (pasta e filtro);
- inclusão e remoção manuais alteram explicitamente a seleção;
- trocar de pasta, filtrar ou atualizar a interface não recria nem descarta a seleção silenciosamente; a reconciliação após nova coleta mantém a interseção com as conversas que continuam selecionáveis e informa os itens removidos.

Funções puras de apoio:

- `selectRange(orderedIds, anchorId, targetId, selectableIds)`: intervalo da seleção por Shift+clique, entre âncora e alvo inclusive, na ordem visível, restrito aos selecionáveis; sem âncora visível, apenas o alvo;
- `dragSet(draggedId, selectedIds)`: conjunto levado por um arraste — a seleção inteira quando o item arrastado está selecionado, senão somente o item.

## MoveBatchCommand

```ts
interface MoveBatchCommand {
  conversationIds: ConversationId[];
  destinationProjectId: ProjectId;
}
```

Pré-condições:

- `conversationIds` contém pelo menos um item;
- todos os identificadores são únicos e não vazios;
- `destinationProjectId` é não vazio;
- o Projeto de destino foi escolhido explicitamente pelo usuário.

## DeleteBatchCommand

```ts
interface DeleteBatchCommand {
  conversationIds: ConversationId[];
}
```

Pré-condições:

- `conversationIds` contém pelo menos um item;
- todos os identificadores são únicos e não vazios;
- a seleção foi formada explicitamente pelo usuário; seleção vazia nunca executa exclusão.

## Resultado por conversa

```ts
type OperationFailureReason =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "integration_error"
  | "unknown";

type MoveFailureReason = OperationFailureReason;
type DeleteFailureReason = OperationFailureReason;

type MoveItemResult =
  | {
      conversationId: ConversationId;
      status: "success";
    }
  | {
      conversationId: ConversationId;
      status: "skipped";
      reason: "already_in_project";
      projectId: ProjectId;
    }
  | {
      conversationId: ConversationId;
      status: "failure";
      reason: MoveFailureReason;
      message: string;
    };
```

```ts
type DeleteItemResult =
  | {
      conversationId: ConversationId;
      status: "success";
    }
  | {
      conversationId: ConversationId;
      status: "skipped";
      reason: "in_project";
      projectId: ProjectId;
    }
  | {
      conversationId: ConversationId;
      status: "failure";
      reason: DeleteFailureReason;
      message: string;
    };

interface DeleteBatchResult {
  items: DeleteItemResult[];
}
```

Antes de excluir um item, a aplicação obtém seu estado atual. Quando `projectId` não é nulo, nenhuma chamada de exclusão é realizada e o item é reportado como `skipped`.

## MoveBatchResult

```ts
interface MoveBatchResult {
  destinationProjectId: ProjectId;
  items: MoveItemResult[];
}
```

Regras:

- existe exatamente um resultado para cada identificador recebido no comando;
- o resultado preserva sucessos, itens ignorados e falhas individuais;
- sucesso total ocorre somente quando todos os itens têm `status: "success"`;
- a falha de uma conversa não transforma itens já processados em sucesso ou falha diferente do resultado real.

## Portas do domínio

```ts
interface ConversationRepository {
  listAll(): Promise<Conversation[]>;
  search(query: string): Promise<ConversationSearchHit[]>;
  get(conversationId: ConversationId): Promise<Conversation>;
  getContext(conversationId: ConversationId): Promise<ConversationContext>;
}

interface ProjectRepository {
  list(): Promise<Project[]>;
}

interface ConversationMover {
  move(command: MoveBatchCommand): Promise<MoveBatchResult>;
}
```

Essas interfaces expressam as necessidades do domínio sem expor autenticação, URLs, cabeçalhos ou payloads da integração.

Antes de mover um item, a aplicação obtém seu estado atual no ChatGPT. Quando `projectId` não é nulo, nenhuma chamada de movimentação é realizada para esse item.

## Evento de debug

```ts
type DebugLevel = "debug" | "info" | "warn" | "error";

interface DebugEvent {
  timestamp: string;
  level: DebugLevel;
  category: string;
  name: string;
  context: Record<string, unknown>;
}
```

`context` contém somente dados sanitizados. Tokens, cookies e informações de autorização são proibidos em qualquer evento.
