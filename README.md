<div align="center">

<img src="icon/icon-128.png" alt="ChatGPT Manager" width="96" height="96">

# ChatGPT Manager

**Organize centenas de conversas do ChatGPT em minutos, direto no Side Panel do Chrome.**

Filtre, selecione em massa e mova conversas para Projetos sem abrir uma por uma.

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Chrome](https://img.shields.io/badge/Chrome-114%2B-34A853)](#instalação)
[![Sem dependências de runtime](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](package.json)
[![Status](https://img.shields.io/badge/status-est%C3%A1vel-brightgreen)](#estado-do-projeto)

[Funcionalidades](#funcionalidades) ·
[Instalação](#instalação) ·
[Como usar](#como-usar) ·
[Privacidade](#privacidade-e-segurança) ·
[Arquitetura](#arquitetura) ·
[Desenvolvimento](#desenvolvimento)

</div>

---

## Por quê?

A interface do ChatGPT foi feita para conversar, não para organizar. Mover dezenas de conversas para um Projeto significa abrir cada uma, clicar no menu e escolher o destino, repetidamente.

O **ChatGPT Manager** carrega todas as suas conversas não arquivadas em uma única lista, mostra em qual Projeto cada uma está e permite reorganizá-las em lote, com arrastar e soltar ou pelo teclado.

## Funcionalidades

| | |
| --- | --- |
| 🗂️ **Pastas com contagem** | Navegue por *Sem projeto*, *Todas* e cada Projeto do ChatGPT. |
| 🔎 **Busca por título ou conteúdo** | Filtro local instantâneo por título ou pesquisa no conteúdo das conversas. |
| ☑️ **Seleção granular e em massa** | Clique, intervalo com <kbd>Shift</kbd>+clique ou todas as visíveis, com ajuste manual depois. |
| 🖱️ **Arrastar e soltar** | Solte a seleção sobre uma pasta para movê-la, ou use o menu **Mover para…**. |
| 👁️ **Contexto sob demanda** | Expanda uma conversa para ver a primeira mensagem, a última resposta e as datas. |
| 🗑️ **Exclusão segura** | Exclua conversas fora de projeto a partir de seleção explícita e sempre com confirmação. |
| 📊 **Resultado por item** | Operações em lote informam sucessos, itens ignorados e falhas individualmente. |
| 💾 **Cache local persistente** | Abrir o painel não faz nenhuma chamada ao ChatGPT; você sincroniza quando quiser. |
| 🐞 **Modo debug** | Logs estruturados do fluxo da extensão para diagnóstico. |

> [!TIP]
> **Convenção LIXEIRA:** crie no ChatGPT um Projeto chamado `LIXEIRA` e use-o como destino das conversas que você quer revisar antes de excluir. A extensão não cria nem trata esse Projeto de forma especial. É apenas uma convenção de uso.

## Instalação

A extensão não está publicada na Chrome Web Store. Requer Google Chrome 114+.

### A partir de uma release (recomendado)

1. Baixe o `chatgpt-manager-vX.Y.Z.zip` da [última release](https://github.com/marinsgabriel1997/extensao-chat-gpt-manager/releases/latest) e descompacte-o numa pasta.
2. Acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** e selecione a pasta descompactada.

Para atualizar, substitua o conteúdo da pasta pelo da nova release e clique em **Recarregar** no card da extensão.

### A partir do código-fonte

**Pré-requisito:** [Node.js](https://nodejs.org/) 18+.

```sh
git clone https://github.com/marinsgabriel1997/extensao-chat-gpt-manager.git
cd extensao-chat-gpt-manager
npm install
npm run build
```

Depois, carregue a pasta do projeto em `chrome://extensions` seguindo os passos 2 a 4 acima.

## Como usar

1. Faça login normalmente em [chatgpt.com](https://chatgpt.com).
2. Clique no ícone do **ChatGPT Manager** para abrir o Side Panel.
3. Clique em **Carregar conversas** na primeira vez. Depois disso, use **Sincronizar** para atualizar.
4. Escolha uma pasta, filtre e selecione as conversas.
5. Arraste a seleção até um Projeto ou use **Mover para…**.

**Atalhos**

| Tecla | Ação |
| --- | --- |
| <kbd>Shift</kbd> + clique | Seleciona um intervalo |
| <kbd>Enter</kbd> | Executa a pesquisa por conteúdo |
| <kbd>Esc</kbd> | Fecha o menu *Mover para…* ou limpa a seleção |

## Privacidade e segurança

- **Sem credenciais externas.** A extensão usa apenas a sessão já autenticada no seu navegador.
- **Sem servidores de terceiros.** Nenhum dado sai do seu navegador além das chamadas ao próprio `chatgpt.com`.
- **Permissões mínimas:** `sidePanel`, `storage` e acesso a `https://chatgpt.com/*`.
- **Ações destrutivas são explícitas.** Uma seleção vazia nunca é tratada como "todas as conversas", e exclusões exigem confirmação.
- **Sem arquivamento em massa** no MVP.

> [!WARNING]
> A integração usa chamadas internas observadas na aplicação web do ChatGPT, que **não são uma API pública nem estável**. Mudanças da OpenAI podem quebrar a extensão sem aviso. Os contratos observados estão documentados em [`docs/chatgpt-integration.md`](docs/chatgpt-integration.md).

## Arquitetura

O código separa interface, aplicação, domínio e integração. Detalhes de endpoints e payloads ficam isolados na camada de integração e nunca chegam ao domínio.

```text
Interface (Side Panel: HTML/CSS/TS)
        │
        ▼
Casos de uso da aplicação
        │
        ▼
Domínio e contratos  ◄──  Adaptadores da integração com o ChatGPT
```

```text
src/
├── sidepanel.ts           # Interface do Side Panel
├── service-worker.ts      # Service worker da extensão (MV3)
├── domain.ts              # Modelos, filtros e seleção
├── conversation-store.ts  # Estado e cache da listagem de conversas
├── search-cache.ts        # Cache da pesquisa por conteúdo
├── integration.ts         # Fronteira com as chamadas internas do ChatGPT
├── messages.ts            # Mensagens entre painel e service worker
└── logger.ts              # Logs estruturados (modo debug)
```

Para mais detalhes, veja a documentação:

- [Requisitos](docs/requirements.md)
- [Contratos de domínio](docs/domain-contracts.md)
- [Arquitetura](docs/architecture.md)
- [Integração observada com o ChatGPT](docs/chatgpt-integration.md)

## Desenvolvimento

**Stack:** Chrome Extension Manifest V3, TypeScript, HTML, CSS, Web APIs e Chrome Extensions APIs nativas, sem framework de UI e sem dependências de runtime.

| Comando | Descrição |
| --- | --- |
| `npm run build` | Compila o TypeScript para `dist/` |
| `npm test` | Compila e executa os testes com o test runner nativo do Node |
| `npm run check` | Build completo seguido dos testes |
| `npm run release` | Publica uma release no GitHub (veja abaixo) |

Depois de alterar o código, rode `npm run build` e clique em **Recarregar** no card da extensão em `chrome://extensions`.

### Releases

As versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/) e as mudanças são registradas no [`CHANGELOG.md`](CHANGELOG.md). Para publicar uma versão:

1. Mova as entradas de `[Unreleased]` no `CHANGELOG.md` para uma nova seção `## [X.Y.Z] - AAAA-MM-DD` e atualize os links de comparação no fim do arquivo.
2. Atualize a versão com `npm version X.Y.Z --no-git-tag-version` e use o mesmo número em `manifest.json`.
3. Faça o commit e o push na `main`.
4. Rode `npm run release`.

O script exige Node.js 22.2+ e o [GitHub CLI](https://cli.github.com/) autenticado. Ele confere se as versões batem, se o repositório está limpo e sincronizado e se a tag ainda não existe. Depois roda o build e os testes, gera o `.zip` instalável em `release/` e cria a tag e a release no GitHub com as notas da versão tiradas do changelog. Com `npm run release -- --dry-run`, ele só gera o pacote e mostra as notas, sem publicar.

As diretrizes de trabalho do projeto estão em [`AGENTS.md`](AGENTS.md) e [`CLAUDE.md`](CLAUDE.md).

## Estado do projeto

✅ **MVP concluído.** Filtragem, seleção, movimentação para Projetos, inventário com cache e exclusão de conversas fora de projeto estão prontos para uso. Daqui para frente o foco é em melhorias. O histórico das entregas fica em [`docs/plans/`](docs/plans/).

## Aviso legal

Este projeto é independente e **não tem afiliação, patrocínio ou endosso da OpenAI**. "ChatGPT" é uma marca da OpenAI. Use por sua conta e risco.
