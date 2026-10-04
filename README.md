# ChatGPT Manager

Extensão Chrome para pesquisar, selecionar e organizar conversas do ChatGPT em massa.

## Objetivo

O ChatGPT Manager reduz o trabalho manual necessário para localizar várias conversas e movê-las para um Projeto do ChatGPT. A extensão usa a sessão já autenticada no ChatGPT e não solicita credenciais externas.

## MVP

O MVP permite:

- listar todas as conversas não arquivadas, com cache local persistente;
- navegar por pastas: Sem projeto, Todas e cada Projeto, com contagem;
- filtrar por título (local) ou pesquisar no conteúdo das conversas;
- selecionar conversas individualmente, por intervalo (Shift+clique) ou todas as visíveis, e ajustar a seleção manualmente;
- mover conversas para um Projeto arrastando-as até a pasta ou pelo menu "Mover para…";
- expandir uma conversa para ver a primeira mensagem, a última resposta e as datas;
- excluir conversas fora de projeto a partir de seleção explícita, com confirmação;
- apresentar o resultado individual das operações em lote;
- disponibilizar um modo debug com logs estruturados do fluxo da extensão.

Arquivamento em massa não faz parte do MVP.

## Conceito de LIXEIRA

O usuário pode criar no ChatGPT um Projeto chamado `LIXEIRA` e escolhê-lo como destino de conversas que deseja revisar posteriormente. Esse nome é uma convenção de uso: a extensão não cria o Projeto automaticamente e não atribui a ele comportamento especial.

## Tecnologia

- Chrome Extension Manifest V3;
- TypeScript;
- HTML e CSS;
- Web APIs nativas;
- Chrome Extensions APIs;
- sem framework de UI.

## Documentação

- [Requisitos](docs/requirements.md)
- [Contratos de domínio](docs/domain-contracts.md)
- [Arquitetura](docs/architecture.md)
- [Integração observada com o ChatGPT](docs/chatgpt-integration.md)

## Interface

A interface principal usa o Side Panel do Chrome (`sidepanel.html` e `src/sidepanel.ts`), com uma única tela de organização.

## Estado do projeto

O projeto está em fase inicial de especificação. A integração depende de chamadas internas observadas na aplicação web do ChatGPT e deve permanecer isolada do domínio e da interface.

## Desenvolvimento

As instruções normativas de trabalho estão em [AGENTS.md](AGENTS.md).

```sh
npm install
npm run build
npm test
```

Depois do build, carregue a pasta do projeto como extensão sem compactação em `chrome://extensions`.
