# Arquitetura

## Visão geral

A extensão segue uma separação em quatro áreas: interface, aplicação, domínio e integração com o ChatGPT.

```text
Interface HTML/CSS
        |
        v
Casos de uso da aplicação
        |
        v
Domínio e contratos
        ^
        |
Adaptadores da integração com o ChatGPT
```

As dependências apontam para os contratos do domínio. Detalhes de endpoints e payloads não atravessam a fronteira da integração.

## Interface

Responsabilidades:

- receber a consulta textual;
- apresentar progresso e resultados da pesquisa;
- permitir seleção individual e em massa;
- apresentar a quantidade e os itens selecionados;
- listar Projetos e receber a escolha do destino;
- iniciar a movimentação;
- apresentar sucessos, itens ignorados e falhas por conversa;
- apresentar a listagem completa de conversas em uma aba dedicada, com filtros por escopo e por título;
- iniciar a exclusão de conversas fora de projeto, individual ou em lote, com confirmação prévia.

A interface principal é apresentada no Side Panel do Chrome e usa HTML, CSS e TypeScript com Web APIs nativas, sem framework de UI. O painel possui duas abas: "Buscar e mover" (pesquisa e movimentação para Projetos) e "Listar e excluir" (listagem completa e exclusão). Trocar de aba não descarta o estado da outra.

Abrir o painel não dispara nenhuma chamada ao ChatGPT. Enquanto não há dados, o carregamento é oferecido como ação principal dentro do próprio estado vazio de cada aba: "Carregar projetos" no lugar do seletor de destino e "Carregar conversas" no espaço da listagem. Depois da primeira carga, esses botões dão lugar aos controles reais e a atualização vira uma ação discreta ("Atualizar") no cabeçalho da seção correspondente. Filtros da listagem só aparecem com dados carregados. O índice completo de conversas por Projeto é construído sob demanda pela primeira pesquisa.

## Aplicação

Os casos de uso coordenam o domínio e as portas de integração:

- pesquisar todas as páginas de conversas;
- remover dos resultados as conversas que já pertencem a Projetos;
- selecionar ou remover uma conversa;
- selecionar todos os resultados da consulta;
- listar todas as páginas de Projetos;
- mover a seleção para o Projeto escolhido;
- impedir movimentações redundantes com base no estado atual da conversa;
- consolidar o resultado individual da operação.

A aplicação impede a execução quando a seleção está vazia ou quando não há Projeto de destino.

## Cache de pesquisa

O Side Panel mantém um cache temporário em memória indexado pela query sem espaços externos e sem distinção entre maiúsculas e minúsculas. O cache existe somente durante o ciclo de vida da página do Side Panel e não usa armazenamento persistente.

Consultas repetidas reutilizam conversas e contagem de itens filtrados. Após uma operação em lote, itens movidos ou ignorados por já estarem em Projetos são removidos de todas as entradas. Itens com falha permanecem disponíveis para nova tentativa.

A camada de integração carrega todas as páginas de Projetos e todas as páginas de conversas de cada Projeto uma vez. Os identificadores formam um `Set<ConversationId>` usado para filtrar pesquisas sem consultar detalhes individuais. A revalidação imediatamente anterior à movimentação consulta o estado atual da conversa.

## Cache persistente da listagem completa

O service worker mantém em `chrome.storage.local` um snapshot versionado da listagem completa: momento da coleta, conversas (somente metadados: identificador, título, data de atualização e vínculo com Projeto) e Projetos. Nenhum token ou dado de autenticação é persistido.

Ao abrir a aba de listagem, somente o snapshot em cache é lido e exibido imediatamente com a idade da coleta; nenhuma chamada ao ChatGPT é disparada automaticamente. A coleta completa é iniciada exclusivamente pelo usuário por um botão dedicado, que também atualiza o snapshot. Uma atualização que falha não sobrescreve o snapshot anterior. Snapshot inválido, corrompido ou de versão desconhecida é descartado.

Após movimentações e exclusões, o service worker aplica as mudanças confirmadas diretamente ao snapshot, sem aguardar nova coleta. A reconciliação na interface substitui a lista e preserva a seleção manual por interseção de identificadores; itens que deixaram de ser selecionáveis saem da seleção com aviso ao usuário.

O cache nunca é fonte de verdade para operações: mover e excluir revalidam o estado atual no ChatGPT antes de agir.

## Revalidação em lote

A revalidação que antecede mover e excluir é feita em uma passada pela listagem de conversas, no momento da operação: uma requisição por página resolve o vínculo com Projeto de todas as conversas do lote, em vez de uma consulta de detalhe por conversa. O endpoint de detalhe é o que sofre limitação de requisições, e o custo deixa de crescer com o tamanho da seleção.

O dado continua vindo do servidor no instante da operação; o que muda é a granularidade da confirmação, não a sua origem. O snapshot resultante existe apenas durante aquela execução e nunca é persistido nem reaproveitado.

Paginações simultâneas da listagem são compartilhadas: coletas concorrentes aguardam a passada já em andamento, e a revalidação de um lote aproveita uma coleta em curso em vez de abrir a sua. Duas paginações do mesmo endpoint só gastariam requisições e aproximariam o limite.

Identificadores que não aparecerem na listagem — conversas arquivadas ou já removidas — caem na consulta de detalhe individual. Se a passada de revalidação falhar, cada item é revalidado individualmente: mais lento, porém nunca menos seguro.

## Controle de requisições

Chamadas à integração são iniciadas com intervalo mínimo de 500 milissegundos, a partir de uma fila serial. Consultas de detalhe, movimentações e exclusões são processadas uma por vez.

Falhas transitórias (rede indisponível, `429`, `5xx`) são retentadas com backoff exponencial e jitter, até um limite de tentativas por requisição. Falhas determinísticas (`400`, `403`, `404`) não são retentadas.

Ao receber `429 Too Many Requests`, a janela de bloqueio é registrada e as requisições seguintes **aguardam dentro da fila** até o fim da janela, em vez de falhar. Como a fila é serial, o lote inteiro pausa e retoma junto, sem cascata de falhas. Uma janela longa demais falha explicitamente, para não congelar a extensão.

A retentativa exige idempotência: uma exclusão confirmada pelo servidor cuja resposta se perdeu não pode ser reportada como falha. As regras observadas estão em [chatgpt-integration.md](chatgpt-integration.md).

Tempo e aleatoriedade são injetáveis na camada de integração, para que o comportamento de espera e backoff seja testável sem depender de tempo real.

## Progresso de operações longas

Operações em lote e a coleta da listagem completa reportam progresso por um callback puro recebido pela camada de integração — ela não conhece as APIs do Chrome. O service worker traduz esse callback em um evento unidirecional para o painel, que atualiza o indicador de estado com a contagem de itens processados ou com a indicação de espera por rate limit.

O evento não substitui o resultado da operação: o painel continua aguardando a resposta única do comando. Painel fechado apenas descarta os eventos; a operação segue no service worker.

## Domínio

O domínio contém:

- modelos de conversa e Projeto;
- consulta textual;
- estado de seleção;
- comando de movimentação em lote;
- resultados discriminados de sucesso e falha;
- portas necessárias para pesquisa, listagem e movimentação.

Os contratos estão definidos em [domain-contracts.md](domain-contracts.md).

## Integração com o ChatGPT

A camada de integração contém:

- obtenção da sessão autenticada;
- execução das chamadas internas observadas;
- paginação baseada em cursores;
- tipos dos payloads crus;
- conversão de payloads crus para modelos do domínio;
- tradução de respostas e erros para resultados do domínio.

Os contratos internos observados permanecem documentados exclusivamente em [chatgpt-integration.md](chatgpt-integration.md).

## Contextos da extensão

O Manifest V3 declara somente as permissões necessárias para executar a interface e acessar o ChatGPT. O contexto responsável pelas chamadas de integração centraliza autenticação, requisições e tradução de respostas. A interface troca apenas comandos e resultados tipados com esse contexto.

Nenhum token de sessão é persistido como dado de domínio ou exibido na interface.

## Fluxo de pesquisa e seleção total

1. A interface envia a consulta textual.
2. A aplicação solicita a primeira página ao repositório de conversas.
3. A integração converte os itens para `Conversation`.
4. Enquanto existir `nextCursor`, a aplicação solicita a página seguinte.
5. A aplicação elimina duplicações por `ConversationId`.
6. A aplicação remove conversas cujo `projectId` não seja nulo.
7. A interface apresenta o conjunto elegível e a quantidade removida.
8. Ao selecionar todos, a seleção recebe os identificadores elegíveis de todas as páginas.
9. Ajustes individuais incluem ou removem identificadores explicitamente.

## Fluxo de movimentação

1. O usuário escolhe um Projeto existente.
2. A aplicação valida a seleção e o destino.
3. A aplicação cria um `MoveBatchCommand` com identificadores únicos.
4. A integração revalida o lote inteiro em uma passada pela listagem de conversas do ChatGPT.
5. Itens que já pertencem ao destino não geram uma nova chamada de movimentação.
6. A integração executa a movimentação dos demais itens.
7. Cada item produz um `MoveItemResult`.
8. A aplicação consolida os itens em `MoveBatchResult`.
9. A interface apresenta sucessos, itens ignorados e falhas separadamente.

## Fluxo de listagem completa

1. Ao abrir a aba, a interface lê somente o cache persistente e o apresenta com a idade da coleta.
2. O usuário inicia a coleta no ChatGPT por um botão dedicado.
3. A integração obtém os nomes dos Projetos por um caminho leve, sem paginar as conversas de cada Projeto (o índice completo continua exclusivo do fluxo de pesquisa).
4. A integração percorre a listagem geral de conversas página a página até receber uma página incompleta.
5. A integração converte cada item para `Conversation`, resolvendo o vínculo com Projeto na fronteira.
6. A aplicação elimina duplicações por `ConversationId` e persiste o novo snapshot.
7. A interface aplica filtros por escopo e por título localmente e preserva a seleção manual.

## Fluxo de exclusão

1. O usuário forma uma seleção explícita de conversas fora de projeto.
2. A interface solicita confirmação com a quantidade selecionada.
3. A aplicação valida a seleção e cria o comando de exclusão com identificadores únicos.
4. A integração revalida o lote inteiro em uma passada pela listagem de conversas do ChatGPT; itens que passaram a pertencer a um Projeto são ignorados e não recebem chamada de exclusão.
5. A integração executa a exclusão dos demais itens, um por vez.
6. Cada item produz um resultado individual; a aplicação consolida sucessos, ignorados e falhas.
7. O cache persistente e as listas exibidas são atualizados com os itens confirmados.
8. A interface apresenta sucessos, ignorados e falhas separadamente.

## Convenção LIXEIRA

`LIXEIRA` é um Projeto comum, criado e mantido pelo usuário no ChatGPT. A arquitetura não contém tipo, endpoint ou regra especial para esse nome. Quando escolhido como destino, ele participa do mesmo fluxo de qualquer outro Projeto.

## Observabilidade e modo debug

Um logger central recebe eventos estruturados da interface, aplicação e integração. O modo debug cobre inicialização, autenticação, requisições, paginação, conversões, filtros, alterações da seleção, validações, operações em lote e erros.

A fronteira do logger sanitiza o contexto antes de emitir qualquer evento. Tokens, cookies e cabeçalhos de autorização nunca são registrados. Cada evento contém data e hora, nível, categoria e nome estável para permitir a reconstrução do fluxo.

## Validação

Comportamentos puros de consulta, seleção, deduplicação, validação de comandos e consolidação de resultados são validados por testes automatizados. Adaptadores são validados com respostas representativas dos contratos observados. O fluxo completo é validado no Chrome com uma sessão real do ChatGPT.
