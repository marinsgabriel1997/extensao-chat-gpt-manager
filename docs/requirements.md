# Requisitos do MVP

## Objetivo do produto

Permitir que um usuário autenticado no ChatGPT pesquise conversas, forme uma seleção explícita e mova essa seleção em massa para um Projeto existente.

## Requisitos funcionais

### RF-01 — Pesquisar conversas

No modo Conteúdo, o usuário informa uma consulta textual. A extensão consulta a pesquisa de conversas do ChatGPT usando o parâmetro `query` e apresenta os resultados com o trecho correspondente. No modo Título, o filtro é aplicado localmente sobre a listagem completa, sem chamadas ao ChatGPT.

### RF-02 — Paginar resultados

A extensão percorre a paginação da pesquisa por meio do cursor fornecido pela integração. Cada conversa encontrada deve aparecer no máximo uma vez no conjunto de resultados.

### RF-03 — Filtrar conversas vinculadas

Os resultados da pesquisa são cruzados com a listagem completa pelo identificador para indicar o Projeto de cada conversa e respeitar a pasta ativa. Conversas em Projeto aparecem com o nome do Projeto, mas não ficam disponíveis para seleção. Resultados ausentes da listagem local são sinalizados, aparecem somente na pasta "Todas" e não são selecionáveis até uma nova coleta.

### RF-04 — Reutilizar pesquisas na sessão

A extensão mantém em memória os resultados de cada consulta por conteúdo durante o ciclo de vida atual do Side Panel. Uma nova pesquisa com a mesma query normalizada reutiliza o resultado sem repetir chamadas ao ChatGPT. O cache é descartado quando o painel ou a extensão é recarregado.

### RF-05 — Selecionar uma conversa

O usuário pode incluir ou remover individualmente qualquer conversa fora de projeto apresentada, clicando na caixa de seleção ou na própria linha. Shift+clique aplica o mesmo estado a todas as conversas selecionáveis entre o último item clicado e o atual, na ordem visível. `Esc`, fora de campos de texto, limpa a seleção.

### RF-06 — Selecionar todos os resultados

O usuário pode selecionar todas as conversas selecionáveis da visão atual (pasta ativa e filtro). A extensão sempre opera sobre identificadores explícitos.

### RF-07 — Ajustar a seleção em massa

Depois de selecionar em massa, o usuário pode remover ou reincluir conversas individualmente. Trocar de pasta, filtrar ou atualizar a interface preserva esses ajustes.

### RF-08 — Exibir a seleção

A extensão mantém visível uma barra com a quantidade de conversas selecionadas, incluindo quantas estão fora da visão atual, e as ações disponíveis para a seleção.

### RF-09 — Listar Projetos

A extensão lista os Projetos existentes e acessíveis ao usuário, percorrendo todas as páginas retornadas pela integração, junto com a coleta da listagem completa. Abrir o painel não dispara chamadas ao ChatGPT.

### RF-10 — Escolher o destino

O usuário escolhe um Projeto existente como destino soltando conversas sobre a pasta do Projeto ou pelo menu "Mover para…". A extensão não cria Projetos automaticamente.

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

A tela de organização lista todas as conversas não arquivadas do usuário, percorrendo todas as páginas da listagem. Cada conversa indica se está fora de projeto ou em qual Projeto está. Conversas de GPTs customizados são tratadas como fora de projeto.

### RF-16 — Filtrar a listagem completa

A listagem completa é organizada em pastas (RF-20) e oferece filtro textual por título, aplicados sobre os dados já carregados, sem novas chamadas. Mudanças de pasta ou de filtro não descartam a seleção existente; a contagem de selecionadas reflete o total real, mesmo quando itens selecionados não estão visíveis.

### RF-17 — Excluir conversas selecionadas

Somente conversas fora de projeto podem ser selecionadas e excluídas. A exclusão exige seleção explícita e confirmação prévia com a quantidade informada, e pode ser individual ou em lote. Antes de excluir, a extensão confirma no ChatGPT o estado atual das conversas do lote, nunca pelo cache local; uma conversa que passou a pertencer a um Projeto é ignorada e reportada como tal. Sucessos, itens ignorados e falhas são apresentados separadamente; falhas parciais não são reportadas como sucesso total.

### RF-18 — Cache local persistente da listagem

A listagem completa e os Projetos são persistidos em `chrome.storage.local` com o momento da coleta, contendo somente metadados (identificador, título, datas de criação e atualização, vínculo com Projeto). Ao abrir o painel, somente o cache local é lido e exibido imediatamente com indicação da idade; nenhuma chamada ao ChatGPT é feita automaticamente. A busca e a atualização são iniciadas exclusivamente pelo usuário por um botão dedicado. A reconciliação após a atualização preserva a seleção manual por interseção de identificadores e reporta itens removidos da seleção. Operações de mover e excluir atualizam o cache imediatamente. O cache nunca substitui a revalidação por item nas operações. Cache inválido ou de versão desconhecida é descartado. Nenhum token ou dado de autenticação é persistido.

### RF-19 — Reprocessar itens que falharam

Após uma operação em lote com falhas parciais, a extensão permite reexecutar a operação exatamente sobre os itens que falharam, sem ampliar o conjunto para a seleção inteira. A retentativa de exclusão continua exigindo confirmação.

### RF-20 — Navegar por pastas

A tela de organização apresenta as pastas "Sem projeto", "Todas" e uma pasta por Projeto, cada uma com a contagem de conversas da listagem completa. Projetos sem conversas aparecem com contagem zero. Selecionar uma pasta lista suas conversas sem exigir consulta textual; "Sem projeto" é a pasta inicial.

### RF-21 — Arrastar conversas para um Projeto

O usuário pode arrastar conversas fora de projeto até a pasta de um Projeto para movê-las. Arrastar uma conversa selecionada move a seleção inteira, inclusive itens fora da visão atual; arrastar uma conversa não selecionada move somente ela, sem alterar a seleção. Durante o arraste, a pasta de destino é destacada com a quantidade a mover. As pastas "Sem projeto" e "Todas" não aceitam soltura. A movimentação segue RF-11 e RF-12, sem diálogo de confirmação. O menu "Mover para…", com filtro por nome, oferece a mesma operação sem arrastar, inclusive por teclado.

### RF-22 — Consultar o contexto de uma conversa

Ao expandir uma conversa, a extensão apresenta a primeira mensagem textual visível do usuário, o início da última resposta textual visível do assistente, as datas de criação e atualização e um controle para abrir a conversa na aba ativa. O detalhe é consultado somente quando a conversa é expandida, uma vez por conversa durante a vida do painel, e nunca é persistido.

## Requisitos não funcionais

### RNF-01 — Autenticação

A extensão usa exclusivamente a sessão autenticada do ChatGPT. Ela não cria bypass de autenticação, não armazena credenciais externas e não solicita tokens ao usuário.

### RNF-02 — Isolamento da integração

Endpoints, cabeçalhos, paginação e payloads internos do ChatGPT ficam restritos à camada de integração. Os demais módulos usam modelos e contratos do domínio.

### RNF-03 — Segurança da seleção

Toda operação em lote recebe um conjunto explícito e não vazio de identificadores de conversas e, quando for movimentação, um identificador explícito de Projeto. Enquanto a operação estiver em andamento, os itens enviados ficam travados na interface: não mudam de seleção, não podem ser arrastados e nenhuma outra operação é iniciada até a resposta.

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

- a tela de organização apresenta as pastas Sem projeto, Todas e cada Projeto com contagens coerentes com a listagem completa;
- selecionar "Sem projeto" lista todas as conversas fora de projeto sem consulta textual;
- o filtro por título atua localmente sobre a pasta ativa;
- a pesquisa por conteúdo percorre todas as páginas, mostra o trecho, respeita a pasta ativa e sinaliza resultados ausentes da listagem local;
- repetir uma query na mesma sessão reutiliza o cache sem novas chamadas de pesquisa;
- a seleção individual inclui e remove conversas sem duplicação; Shift+clique seleciona o intervalo visível;
- "selecionar visíveis" inclui somente os itens selecionáveis da visão atual;
- ajustes manuais são preservados ao trocar de pasta, filtrar ou atualizar;
- arrastar uma conversa selecionada para um Projeto move a seleção inteira; arrastar uma não selecionada move somente ela;
- "Mover para…" permite a mesma operação sem arrastar, inclusive por teclado;
- somente conversas explicitamente selecionadas ou arrastadas são movidas;
- uma conversa que já pertença a qualquer Projeto não recebe nova solicitação de movimentação;
- conversas em Projeto não são selecionáveis, arrastáveis nem excluíveis;
- seleção vazia não executa nenhuma operação;
- sucessos, itens ignorados e falhas são apresentados separadamente por operação;
- expandir uma conversa apresenta primeira mensagem, última resposta, datas e abrir, com uma única consulta por conversa na sessão do painel e sem persistir conteúdo de mensagens;
- o modo debug registra o fluxo completo sem expor dados de autenticação;
- com cache persistente disponível, o painel exibe os dados imediatamente e indica a idade da coleta, sem chamadas automáticas ao ChatGPT;
- a exclusão exige seleção explícita e confirmação, revalida o estado de cada conversa e reporta sucessos, ignoradas e falhas separadamente;
- mover ou excluir conversas atualiza o cache persistente, as pastas e as contagens;
- o fluxo funciona em uma instalação local da extensão no Chrome com uma sessão válida do ChatGPT.
