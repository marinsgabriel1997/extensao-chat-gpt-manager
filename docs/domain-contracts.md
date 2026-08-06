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
  updatedAt: string | null;
}
```

Representa uma conversa disponível para apresentação e seleção. `preview` contém o trecho retornado pela pesquisa do ChatGPT ou uma string vazia quando não houver trecho. `updatedAt` contém a última atualização em ISO 8601 ou `null` quando a integração não fornecer o dado. Campos adicionais da integração não integram automaticamente o domínio.

Uma conversa é elegível para os resultados de pesquisa quando `projectId` é `null`. Conversas com `projectId` não nulo são removidas antes da formação da seleção de movimentação. Conversas de GPTs customizados não possuem vínculo com Projeto e mantêm `projectId` nulo.

## ConversationScopeFilter

```ts
type ConversationScopeFilter = "outside_project" | "in_project" | "all";
```

Filtro de escopo da listagem completa. `filterByScope` é uma função pura que aplica o filtro sem alterar a coleção original. O filtro é um conceito de domínio independente da UI; mudanças de filtro nunca alteram a seleção.

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

```ts
interface ConversationSelection {
  query: ConversationQuery;
  conversationIds: Set<ConversationId>;
}
```

Regras:

- a seleção pertence a uma única consulta;
- cada identificador aparece no máximo uma vez;
- seleção vazia representa nenhuma conversa;
- selecionar todos percorre todas as páginas e adiciona cada identificador encontrado;
- inclusão e remoção manuais alteram explicitamente `conversationIds`;
- renderizações da interface não recriam nem descartam a seleção silenciosamente.

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
  search(query: ConversationQuery, cursor: string | null): Promise<Page<Conversation>>;
  get(conversationId: ConversationId): Promise<Conversation>;
}

interface ProjectRepository {
  list(cursor: string | null): Promise<Page<Project>>;
}

interface ConversationMover {
  move(command: MoveBatchCommand): Promise<MoveBatchResult>;
}
```

Essas interfaces expressam as necessidades do domínio sem expor autenticação, URLs, cabeçalhos ou payloads da integração.

Antes de mover um item, a aplicação obtém seu estado atual por meio do repositório. Quando `projectId` não é nulo, nenhuma chamada de movimentação é realizada para esse item.

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
