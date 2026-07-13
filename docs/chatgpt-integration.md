# ChatGPT Integration

## Observado

### Autenticacao

- A pagina usa `GET /api/auth/session` para obter sessao.
- A resposta inclui `accessToken`.
- Chamadas para `/backend-api/*` funcionaram com header `Authorization: Bearer <accessToken>`.

### Conversas

- `GET /backend-api/conversations`
  - Query params observados:
    - `offset`
    - `limit`
    - `order`
    - `is_archived`
    - `is_starred`
    - `hide_snorlax`
  - Resposta observada:
    - `items`
    - `total`
    - `limit`
    - `offset`
  - Inferencia a partir do trafego observado:
    - `hide_snorlax=true` tende a ocultar conversas vinculadas a projetos, consistente com o fato de os projetos observados usarem `gizmo_type = "snorlax"`
    - tratar esse comportamento como observado por inferencia, nao como contrato estavel sem nova validacao

- `GET /backend-api/conversations/search`
  - Query params observados:
    - `query`
    - `cursor`
- Resposta observada:
  - `items`
  - `cursor`
  - os itens podem expor `conversation_id` como identificador util para operacoes posteriores
  - nao assumir que o identificador vira em `id`
  - o trecho correspondente a pesquisa foi observado em `item.payload.snippet`

- `GET /backend-api/conversation/{conversation_id}`
  - Usado para obter detalhe da conversa.
  - O payload observado inclui `mapping` e `current_node`.
  - `mapping` e uma tabela de nos ligados pelos campos `parent` e `children`.
  - O caminho ativo pode ser percorrido de `current_node` ate a raiz por `parent` e invertido para obter a ordem da conversa.
  - Uma mensagem textual visivel do usuario foi observada em:
    - `node.message.author.role = "user"`
    - `node.message.content.content_type = "text"`
    - `node.message.content.parts[]`
  - Mensagens com `node.message.metadata.is_visually_hidden_from_conversation = true` nao representam texto visivel da conversa.
  - Conversas fora de Projetos podem ser abertas na rota `/c/{conversation_id}`.

### Projetos

- `GET /backend-api/gizmos/snorlax/sidebar`
  - Confirmado como endpoint usado na listagem de projetos/chats da sidebar.
  - Query params observados:
    - `owned_only`
    - `conversations_per_gizmo`
    - `limit`
  - Combinacao validada para listagem:
    - `owned_only=true`
    - `conversations_per_gizmo=5`
    - `limit=20`
  - Combinacao rejeitada com `422 Unprocessable Entity`:
    - `owned_only=true`
    - `conversations_per_gizmo=0`
    - `limit=100`
  - Estrutura de resposta observada:
    - `items`
    - `cursor`
  - A resposta observada retornou 20 projetos em uma pagina com `cursor` no nivel raiz.
  - Cada item da lista inclui:
    - `gizmo`
    - `conversations`
  - O projeto observado vem aninhado em `item.gizmo.gizmo`.
  - Campos observados uteis em `item.gizmo.gizmo`:
    - `id`
    - `short_url`
    - `display.name`
    - `display.description`
    - `created_at`
    - `updated_at`
    - `last_interacted_at`
    - `num_interactions`
    - `is_archived`
    - `memory_enabled`
    - `memory_scope`
    - `current_user_permission`
    - `gizmo_type`
  - Campos observados uteis em `item.gizmo`:
    - `tools`
    - `files`
    - `product_features`
    - `has_tpp_conversation`
    - `project_file_limits`
    - `project_connector_scope_limits`
  - `item.gizmo.files` pode listar arquivos anexados ao projeto.
  - `conversations` segue o formato:
    - `items`
    - `cursor`
  - Campos observados uteis em `item.conversations.items[]`:
    - `id`
    - `title`
    - `create_time`
    - `update_time`
    - `conversation_template_id`
    - `gizmo_id`
    - `is_archived`
    - `memory_scope`
    - `snippet`
    - `owner`
  - O `cursor` na raiz pagina a lista de projetos.
  - O `cursor` em `item.conversations.cursor` pagina a lista de conversas daquele projeto.
  - Quando `conversations_per_gizmo=5`, a resposta funciona como previa por projeto; nao assumir que `item.conversations.items` contem todas as conversas.

- `POST /backend-api/projects`
  - Body observado:

```json
{
  "instructions": "",
  "name": "teste",
  "memory_scope": "unset"
}
```

- `GET /backend-api/projects`
  - Retorno observado: `405 Method Not Allowed`
  - Nao usar como endpoint de listagem.

- `GET /backend-api/projects/{project_id}/saves?limit=100`
- `GET /backend-api/projects/{project_id}/connector_scopes?limit=100`

### Conversas de projeto

- `GET /backend-api/gizmos/{project_id}/conversations`
  - Query params observados:
    - `cursor`
    - `limit`
    - `owned_only`
  - Fluxo de continuacao observado:
    - usar o cursor retornado em `item.conversations.cursor` da sidebar na primeira chamada
    - `limit=5`
    - `owned_only=true`
    - cada resposta contem `items` e `cursor`
    - enquanto `cursor` nao for nulo, a proxima chamada usa esse novo valor
- Os itens retornados incluem campos como:
  - `id`
  - `title`
  - `conversation_template_id`
  - `gizmo_id`
  - `snippet`
  - `owner`

### Mover conversa para projeto

- `PATCH /backend-api/conversation/{conversation_id}`
  - Body observado:

```json
{
  "gizmo_id": "g-p-..."
}
```

- Resposta observada:

```json
{
  "success": true
}
```

- Teste validado:
  - uma conversa fora do projeto foi movida com sucesso para o projeto via `PATCH`
  - apos a operacao, a URL da conversa passou a usar o contexto do projeto
  - apos a operacao, o detalhe da conversa refletiu o projeto em `gizmo_id` e `conversation_template_id`
  - uma busca por `trello` retornou 27 conversas utilizaveis
  - as 27 conversas foram movidas com sucesso para o projeto `g-p-6a08b437f158819183f645c895018d1c`
  - no fluxo em lote validado, o identificador usado para mover as conversas veio de `conversation_id`

### Detalhe da conversa vinculada a projeto

- `GET /backend-api/conversation/{conversation_id}`
  - Depois de mover a conversa para um projeto, o detalhe refletiu:
    - `gizmo_id = g-p-...`
    - `conversation_template_id = g-p-...`
  - Em navegacao dentro de um projeto, foi observado o header:
    - `chatgpt-project-id: g-p-...`

## Pendente

- Confirmar resposta completa de `POST /backend-api/projects`.
- Confirmar como remover conversa de um projeto.
- Confirmar como a conversa reflete o vinculo com projeto no payload detalhado.
