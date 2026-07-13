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
  projectId: ProjectId | null;
}
```

Representa uma conversa disponível para apresentação e seleção. Campos adicionais da integração não integram automaticamente o domínio.

Uma conversa é elegível para os resultados quando `projectId` é `null`. Conversas com `projectId` não nulo são removidas antes da formação da seleção.

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

## Resultado por conversa

```ts
type MoveFailureReason =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "integration_error"
  | "unknown";

type MoveItemResult =
  | {
      conversationId: ConversationId;
      status: "success";
    }
  | {
      conversationId: ConversationId;
      status: "skipped";
      reason: "already_in_destination";
    }
  | {
      conversationId: ConversationId;
      status: "failure";
      reason: MoveFailureReason;
      message: string;
    };
```

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

Antes de mover um item, a aplicação obtém seu estado atual por meio do repositório. Quando `projectId` coincide com `destinationProjectId`, nenhuma chamada de movimentação é realizada para esse item.

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
