# ChatGPT Manager

Extensão Chrome para pesquisar, selecionar e organizar conversas do ChatGPT em massa.

## Objetivo

O ChatGPT Manager reduz o trabalho manual necessário para localizar várias conversas e movê-las para um Projeto do ChatGPT. A extensão usa a sessão já autenticada no ChatGPT e não solicita credenciais externas.

## MVP

O MVP permite:

- pesquisar conversas por texto;
- ocultar dos resultados conversas que já pertencem a Projetos;
- selecionar conversas individualmente;
- selecionar todas as conversas de uma pesquisa, incluindo todas as páginas do resultado;
- ajustar manualmente uma seleção em massa;
- listar Projetos existentes do ChatGPT;
- mover as conversas selecionadas para um Projeto;
- apresentar o resultado individual das operações em lote.
- disponibilizar um modo debug com logs estruturados do fluxo da extensão.

Exclusão e arquivamento em massa não fazem parte do MVP.

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

A interface principal usa o Side Panel do Chrome. O arquivo `sidepanel.html` contém o protótipo visual estático inicial.

## Estado do projeto

O projeto está em fase inicial de especificação. A integração depende de chamadas internas observadas na aplicação web do ChatGPT e deve permanecer isolada do domínio e da interface.

## Desenvolvimento

As instruções normativas de trabalho estão em [AGENTS.md](AGENTS.md). O repositório ainda não possui comandos oficiais de instalação, build, testes ou lint.
