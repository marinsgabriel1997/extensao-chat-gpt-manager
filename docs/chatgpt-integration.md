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
  - Captura completa observada (2026-08-05), com `offset=56&limit=28&order=updated&is_archived=false&is_starred=false&hide_snorlax=true`:
    - resposta com `items`, `total`, `limit`, `offset` no nivel raiz
    - `limit=100` foi aceito e retornou normalmente (testado em 2026-08-05 com `offset=0`)
    - `total` NAO e a contagem real de conversas; nas observacoes ele correspondeu a `offset + limit + 1` quando existiam mais paginas (`offset=56&limit=28` → `total: 85`; `offset=0&limit=28` → `total: 29`)
    - nao usar `total` para dimensionar ou encerrar a paginacao; paginar incrementando `offset` ate uma pagina retornar menos itens que `limit` (comportamento de fim de lista ainda nao observado; validar na implementacao)
    - campos observados uteis em `items[]`:
      - `id`
      - `title`
      - `create_time`
      - `update_time`
      - `conversation_template_id`
      - `gizmo_id`
      - `is_archived`
      - `is_starred`
      - `is_temporary_chat`
      - `snippet` (observado sempre `null` nessa listagem)
    - mesmo com `hide_snorlax=true`, itens retornaram `gizmo_id`/`conversation_template_id` preenchidos com prefixo `g-` (sem `-p-`): sao conversas de GPTs customizados, nao de Projetos
    - isso reforca a distincao ja aplicada na integracao: somente ids com prefixo `g-p-` representam Projetos; `g-...` sem `-p-` nao deve ser tratado como Projeto
  - Comportamento de `hide_snorlax` (observacoes de 2026-08-05, mesma pagina `offset=0&limit=28`):
    - projetos usam `gizmo_type = "snorlax"`, entao a leitura natural e "ocultar conversas de Projetos"
    - `hide_snorlax=false` e parametro ausente se comportaram igual: 6 itens `g-p-` na pagina — conversas de Projetos VEM na listagem, com o id do Projeto em `gizmo_id`/`conversation_template_id`
    - `hide_snorlax=true`: 1 item `g-p-` ainda presente na mesma pagina — o parametro reduz mas nao eliminou conversas de Projetos na observacao
    - tratar como inferencia parcial: `hide_snorlax=true` oculta a maioria das conversas de Projetos, mas nao garantir exclusao total
    - para listagem completa (incluindo Projetos), usar o parametro ausente ou `false` e resolver o vinculo pelo prefixo `g-p-` do item; nao depender de `hide_snorlax` para filtrar

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

### Excluir conversa

- `DELETE /backend-api/conversation/id/{conversation_id}`
  - Capturado na exclusão de uma conversa pela UI do ChatGPT (2026-08-05).
  - A rota inclui o segmento literal `/id/` antes do identificador; nao confundir com a rota do PATCH de movimentacao (`/backend-api/conversation/{conversation_id}`, sem `/id/`).
  - Body observado: vazio (`null`).
  - Resposta observada:

```json
{
  "success": true
}
```

  - A requisicao observada incluiu, alem de `Authorization: Bearer <accessToken>`, headers como `chatgpt-account-id`, `oai-device-id` e `oai-session-id`; ainda nao foi validado se a chamada funciona somente com `Authorization`, como as demais chamadas da integracao.
  - Nao foi observado se a exclusao e recuperavel (lixeira) ou permanente do lado do ChatGPT.

### Detalhe da conversa vinculada a projeto

- `GET /backend-api/conversation/{conversation_id}`
  - Depois de mover a conversa para um projeto, o detalhe refletiu:
    - `gizmo_id = g-p-...`
    - `conversation_template_id = g-p-...`
  - Em navegacao dentro de um projeto, foi observado o header:
    - `chatgpt-project-id: g-p-...`

### Rate limit e retentativas

Política adotada pela extensão sobre as chamadas acima (2026-08-06):

- Status retentáveis: `429`, `500`, `502`, `503`, `504`, além de falhas de rede (o `fetch` rejeita).
- Status não retentáveis: `400`, `403`, `404` e demais 4xx determinísticos — repetir produziria o mesmo resultado.
- Até 3 tentativas por requisição, com backoff exponencial (1 s, 2 s) e jitter de ±25%. O jitter evita que itens de um mesmo lote sincronizem as retentativas e reincidam no limite em bloco.
- Em `429`, a janela de bloqueio é lida de `Retry-After` (segundos ou data HTTP), com 60 s como padrão quando o header está ausente. Enquanto a janela está aberta, as requisições seguintes **aguardam** — não falham. Janela maior que 120 s falha explicitamente em vez de congelar a operação.
- `401` continua fora do backoff: o token é renovado por `GET /api/auth/session` e a requisição é refeita uma vez.
- Idempotência de `DELETE /backend-api/conversation/id/{conversation_id}`: um `404` recebido em **retentativa** é tratado como sucesso, porque indica que a exclusão anterior chegou ao servidor e apenas a resposta se perdeu. Um `404` na primeira tentativa permanece falha (`not_found`), pois normalmente indica identificador vindo de cache desatualizado.
- `PATCH /backend-api/conversation/{conversation_id}` com `gizmo_id` é idempotente por natureza; repetir a chamada é seguro.

## Pendente

- Confirmar resposta completa de `POST /backend-api/projects`.
- Confirmar se `DELETE /backend-api/conversation/id/{conversation_id}` funciona somente com `Authorization: Bearer`, sem os demais headers `oai-*`/`chatgpt-account-id`.
- Confirmar se a exclusao de conversa e recuperavel ou permanente.
- Confirmar os campos dos itens retornados por `GET /backend-api/conversations` e o comportamento de `hide_snorlax=false` (ou ausente) para listar conversas vinculadas a projetos.
- Confirmar como remover conversa de um projeto.
- Confirmar como a conversa reflete o vinculo com projeto no payload detalhado.
