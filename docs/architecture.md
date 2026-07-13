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
- apresentar sucessos, itens ignorados e falhas por conversa.

A interface principal é apresentada no Side Panel do Chrome e usa HTML, CSS e TypeScript com Web APIs nativas, sem framework de UI.

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
4. A aplicação confirma o estado atual de cada conversa.
5. Itens que já pertencem ao destino não geram uma nova chamada de movimentação.
6. A integração executa a movimentação dos demais itens.
7. Cada item produz um `MoveItemResult`.
8. A aplicação consolida os itens em `MoveBatchResult`.
9. A interface apresenta sucessos, itens ignorados e falhas separadamente.

## Convenção LIXEIRA

`LIXEIRA` é um Projeto comum, criado e mantido pelo usuário no ChatGPT. A arquitetura não contém tipo, endpoint ou regra especial para esse nome. Quando escolhido como destino, ele participa do mesmo fluxo de qualquer outro Projeto.

## Observabilidade e modo debug

Um logger central recebe eventos estruturados da interface, aplicação e integração. O modo debug cobre inicialização, autenticação, requisições, paginação, conversões, filtros, alterações da seleção, validações, operações em lote e erros.

A fronteira do logger sanitiza o contexto antes de emitir qualquer evento. Tokens, cookies e cabeçalhos de autorização nunca são registrados. Cada evento contém data e hora, nível, categoria e nome estável para permitir a reconstrução do fluxo.

## Validação

Comportamentos puros de consulta, seleção, deduplicação, validação de comandos e consolidação de resultados são validados por testes automatizados. Adaptadores são validados com respostas representativas dos contratos observados. O fluxo completo é validado no Chrome com uma sessão real do ChatGPT.
