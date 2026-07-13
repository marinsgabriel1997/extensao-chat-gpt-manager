# Requisitos do MVP

## Objetivo do produto

Permitir que um usuário autenticado no ChatGPT pesquise conversas, forme uma seleção explícita e mova essa seleção em massa para um Projeto existente.

## Requisitos funcionais

### RF-01 — Pesquisar conversas

O usuário informa uma consulta textual. A extensão consulta a pesquisa de conversas do ChatGPT usando o parâmetro `query` e apresenta os resultados encontrados.

### RF-02 — Paginar resultados

A extensão percorre a paginação da pesquisa por meio do cursor fornecido pela integração. Cada conversa encontrada deve aparecer no máximo uma vez no conjunto de resultados.

### RF-03 — Filtrar conversas vinculadas

A extensão remove dos resultados disponíveis para seleção todas as conversas que já pertencem a qualquer Projeto. A quantidade removida é apresentada ao usuário.

### RF-04 — Reutilizar pesquisas na sessão

A extensão mantém em memória os resultados de cada consulta e um índice dos IDs de conversas vinculadas a Projetos durante o ciclo de vida atual do Side Panel. Uma nova pesquisa com a mesma query normalizada reutiliza o resultado sem repetir chamadas ao ChatGPT. O cache é descartado quando o painel ou a extensão é recarregado.

### RF-05 — Selecionar uma conversa

O usuário pode incluir ou remover individualmente qualquer conversa apresentada na seleção atual.

Cada conversa apresenta o trecho retornado pela pesquisa do ChatGPT em um preview responsivo limitado a quatro linhas. Um controle `↗` na borda interna direita do item abre a conversa na aba ativa sem fechar o Side Panel.

### RF-06 — Selecionar todos os resultados

O usuário pode selecionar todas as conversas correspondentes à consulta, incluindo resultados de todas as páginas. A extensão deve obter identificadores explícitos antes de executar uma operação em lote.

### RF-07 — Ajustar a seleção em massa

Depois de selecionar todos os resultados, o usuário pode remover ou reincluir conversas individualmente. Atualizações da interface preservam esses ajustes enquanto a consulta permanecer a mesma.

### RF-08 — Exibir a seleção

A extensão informa a quantidade de conversas selecionadas e permite identificar quais conversas participarão da operação.

### RF-09 — Listar Projetos

A extensão lista os Projetos existentes e acessíveis ao usuário, percorrendo todas as páginas retornadas pela integração.

### RF-10 — Escolher o destino

O usuário escolhe um Projeto existente como destino. A extensão não cria Projetos automaticamente.

### RF-11 — Mover conversas em lote

A extensão move cada conversa explicitamente selecionada para o Projeto escolhido. Uma seleção vazia nunca inicia uma operação e nunca representa todas as conversas.

Antes de cada movimentação, a extensão confirma o estado atual da conversa e não envia uma solicitação de movimentação quando ela já pertence a qualquer Projeto.

### RF-12 — Apresentar o resultado da operação

Ao concluir uma operação em lote, a extensão informa separadamente os itens processados com sucesso, os itens ignorados por já estarem no destino e os itens que falharam. Falhas parciais não são apresentadas como sucesso total.

### RF-13 — Usar um Projeto como área de revisão

Um Projeto criado previamente pelo usuário, como `LIXEIRA`, pode ser escolhido como destino para separar conversas que serão revisadas posteriormente. O nome não altera o comportamento da extensão.

### RF-14 — Operar em modo debug

A extensão oferece um modo debug que registra eventos estruturados de inicialização, autenticação, pesquisa, paginação, conversão de dados, filtragem, seleção, validação, movimentação e tratamento de erros.

## Requisitos não funcionais

### RNF-01 — Autenticação

A extensão usa exclusivamente a sessão autenticada do ChatGPT. Ela não cria bypass de autenticação, não armazena credenciais externas e não solicita tokens ao usuário.

### RNF-02 — Isolamento da integração

Endpoints, cabeçalhos, paginação e payloads internos do ChatGPT ficam restritos à camada de integração. Os demais módulos usam modelos e contratos do domínio.

### RNF-03 — Segurança da seleção

Toda operação em lote recebe um conjunto explícito e não vazio de identificadores de conversas e um identificador explícito de Projeto.

### RNF-04 — Consistência

Uma conversa não pode aparecer duplicada na seleção nem ser processada mais de uma vez na mesma operação em lote.

### RNF-05 — Rastreabilidade do resultado

O resultado de cada item da operação deve ser determinável como sucesso ou falha, acompanhado de informação suficiente para apresentação ao usuário.

### RNF-06 — Compatibilidade

A extensão usa Manifest V3, TypeScript, HTML, CSS, Web APIs e Chrome Extensions APIs nativas, sem framework de UI.

### RNF-07 — Proteção dos logs

Logs nunca contêm tokens de acesso, cookies, cabeçalhos de autorização ou outros segredos de autenticação. Erros e dados de requisições são sanitizados antes do registro.

### RNF-08 — Diagnóstico

Cada evento de debug contém data e hora, nível, categoria, nome do evento e contexto sanitizado suficiente para reconstruir o fluxo executado.

### RNF-09 — Controle de requisições

A extensão limita a frequência e a concorrência das chamadas internas. Respostas `429 Too Many Requests` interrompem a operação e são apresentadas ao usuário sem repetição automática.

## Fora do escopo do MVP

- excluir conversas em massa;
- arquivar conversas em massa;
- criar, renomear ou excluir Projetos;
- tratar `LIXEIRA` como tipo especial de Projeto;
- remover conversas de um Projeto;
- usar credenciais externas.

## Critérios de aceite do MVP

- uma consulta textual retorna e apresenta conversas de todas as páginas disponíveis;
- conversas que já pertencem a Projetos não ficam disponíveis para seleção;
- repetir uma query na mesma sessão reutiliza o cache sem novas chamadas de pesquisa ou detalhe;
- a seleção individual inclui e remove conversas sem duplicação;
- a seleção em massa inclui todas as páginas da consulta;
- ajustes manuais posteriores são preservados;
- Projetos acessíveis são listados por todas as páginas disponíveis;
- somente conversas explicitamente selecionadas são movidas;
- uma conversa que já pertença a qualquer Projeto não recebe nova solicitação de movimentação;
- seleção vazia não executa nenhuma operação;
- o Projeto de destino é escolhido entre Projetos existentes;
- sucessos, itens ignorados e falhas são apresentados separadamente por conversa;
- conversas movidas ou ignoradas são removidas de todas as pesquisas armazenadas no cache;
- o modo debug registra o fluxo completo sem expor dados de autenticação;
- o fluxo funciona em uma instalação local da extensão no Chrome com uma sessão válida do ChatGPT.
