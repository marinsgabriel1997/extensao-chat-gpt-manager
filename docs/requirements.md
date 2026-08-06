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

A extensão lista os Projetos existentes e acessíveis ao usuário, percorrendo todas as páginas retornadas pela integração. A listagem é iniciada pelo usuário por um botão dedicado; abrir o painel não dispara chamadas ao ChatGPT.

### RF-10 — Escolher o destino

O usuário escolhe um Projeto existente como destino. A extensão não cria Projetos automaticamente.

### RF-11 — Mover conversas em lote

A extensão move cada conversa explicitamente selecionada para o Projeto escolhido. Uma seleção vazia nunca inicia uma operação e nunca representa todas as conversas.

Antes de mover, a extensão confirma no ChatGPT o estado atual das conversas do lote e não envia uma solicitação de movimentação para conversas que já pertencem a qualquer Projeto. A confirmação nunca vem do cache local.

### RF-12 — Apresentar o resultado da operação

Ao concluir uma operação em lote, a extensão informa separadamente os itens processados com sucesso, os itens ignorados por já estarem no destino e os itens que falharam. Falhas parciais não são apresentadas como sucesso total.

### RF-13 — Usar um Projeto como área de revisão

Um Projeto criado previamente pelo usuário, como `LIXEIRA`, pode ser escolhido como destino para separar conversas que serão revisadas posteriormente. O nome não altera o comportamento da extensão.

### RF-14 — Operar em modo debug

A extensão oferece um modo debug que registra eventos estruturados de inicialização, autenticação, pesquisa, paginação, conversão de dados, filtragem, seleção, validação, movimentação, exclusão, cache persistente e tratamento de erros.

### RF-15 — Listar todas as conversas

Uma aba dedicada lista todas as conversas não arquivadas do usuário, percorrendo todas as páginas da listagem. Cada conversa indica se está fora de projeto ou em qual Projeto está. Conversas de GPTs customizados são tratadas como fora de projeto.

### RF-16 — Filtrar a listagem completa

A listagem completa oferece filtro por escopo (fora de projeto, em projeto, todas) e filtro textual por título, aplicados sobre os dados já carregados, sem novas chamadas. Mudanças de filtro não descartam a seleção existente; a contagem de selecionadas reflete o total real, mesmo quando itens selecionados não estão visíveis.

### RF-17 — Excluir conversas selecionadas

Somente conversas fora de projeto podem ser selecionadas e excluídas. A exclusão exige seleção explícita e confirmação prévia com a quantidade informada, e pode ser individual ou em lote. Antes de excluir, a extensão confirma no ChatGPT o estado atual das conversas do lote, nunca pelo cache local; uma conversa que passou a pertencer a um Projeto é ignorada e reportada como tal. Sucessos, itens ignorados e falhas são apresentados separadamente; falhas parciais não são reportadas como sucesso total.

### RF-18 — Cache local persistente da listagem

A listagem completa e os Projetos são persistidos em `chrome.storage.local` com o momento da coleta, contendo somente metadados (identificador, título, data de atualização, vínculo com Projeto). Ao abrir a aba, somente o cache local é lido e exibido imediatamente com indicação da idade; nenhuma chamada ao ChatGPT é feita automaticamente. A busca e a atualização são iniciadas exclusivamente pelo usuário por um botão dedicado. A reconciliação após a atualização preserva a seleção manual por interseção de identificadores e reporta itens removidos da seleção. Operações de mover e excluir atualizam o cache imediatamente. O cache nunca substitui a revalidação por item nas operações. Cache inválido ou de versão desconhecida é descartado. Nenhum token ou dado de autenticação é persistido.

### RF-19 — Reprocessar itens que falharam

Após uma operação em lote com falhas parciais, a extensão permite reexecutar a operação exatamente sobre os itens que falharam, sem ampliar o conjunto para a seleção inteira. A retentativa de exclusão continua exigindo confirmação.

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

A extensão limita a frequência e a concorrência das chamadas internas.

### RNF-10 — Tolerância a falhas transitórias

Falhas transitórias (rede indisponível, `429 Too Many Requests`, erros `5xx`) são retentadas automaticamente com espera crescente e limite de tentativas. Falhas determinísticas não são retentadas. Uma resposta `429` faz a operação aguardar a janela indicada e prosseguir, em vez de falhar os itens restantes; uma janela longa demais falha explicitamente. Nenhuma retentativa pode transformar uma operação já concluída no servidor em falha reportada ao usuário.

### RNF-11 — Progresso de operações longas

Durante operações em lote e a coleta da listagem completa, a extensão informa continuamente quantos itens já foram processados e sinaliza quando está aguardando por limite de requisições do ChatGPT.

## Fora do escopo do MVP

- excluir conversas que pertencem a um Projeto;
- listar ou excluir conversas arquivadas;
- arquivar conversas em massa;
- criar, renomear ou excluir Projetos;
- tratar `LIXEIRA` como tipo especial de Projeto;
- remover conversas de um Projeto;
- usar credenciais externas.

A exclusão de conversas fora de projeto foi incluída no MVP por decisão explícita do usuário em 2026-08-05 (RF-17).

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
- a aba de listagem completa apresenta todas as conversas não arquivadas com o vínculo de Projeto correto;
- com cache persistente disponível, a aba exibe os dados imediatamente, indica a idade da coleta e atualiza em segundo plano;
- somente conversas fora de projeto são selecionáveis e excluíveis, sempre com confirmação prévia;
- a exclusão revalida o estado de cada conversa e reporta sucessos, ignoradas e falhas separadamente;
- mover ou excluir conversas atualiza o cache persistente e as listas exibidas;
- a seleção manual da listagem completa sobrevive a mudanças de filtro e à atualização em segundo plano;
- o fluxo funciona em uma instalação local da extensão no Chrome com uma sessão válida do ChatGPT.
