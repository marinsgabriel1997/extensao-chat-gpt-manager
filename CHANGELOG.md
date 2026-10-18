# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [1.0.0] - 2026-10-18

Primeira versão estável: conclusão do MVP.

### Adicionado

- Side Panel do Chrome com uma única tela de organização, construída sobre a listagem completa de conversas não arquivadas.
- Pastas *Sem projeto*, *Todas* e uma por Projeto do ChatGPT, com contagem de conversas.
- Filtro local por título e pesquisa no conteúdo das conversas, com os resultados cruzados com a listagem completa.
- Seleção individual, por intervalo (<kbd>Shift</kbd>+clique) e de todas as conversas visíveis, com ajuste manual e contagem de itens fora da visão atual.
- Movimentação de conversas para um Projeto arrastando-as até a pasta ou pelo menu **Mover para…**.
- Contexto sob demanda ao expandir uma conversa: primeira mensagem, última resposta, datas e atalho para abrir no ChatGPT.
- Exclusão de conversas fora de projeto, individual ou em lote, a partir de seleção explícita e sempre com confirmação.
- Resultado individual das operações em lote, com sucessos, itens ignorados e falhas, e opção de tentar novamente somente os itens que falharam.
- Progresso das operações em lote informado em tempo real.
- Cache local persistente da listagem: abrir o painel não faz chamadas ao ChatGPT, e o botão **Sincronizar** atualiza a lista quando o usuário quiser.
- Bloqueio dos itens em operação, que não podem ser selecionados nem arrastados até a resposta.
- Atalho <kbd>Esc</kbd> para fechar o menu **Mover para…** ou limpar a seleção.
- Aba de debug com logs estruturados do fluxo da extensão.
- Resiliência de rede: espera pelo fim da janela de limite de requisições, novas tentativas com backoff exponencial para falhas transitórias e revalidação em lote do estado das conversas antes de mover ou excluir.

[Unreleased]: https://github.com/marinsgabriel1997/extensao-chat-gpt-manager/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/marinsgabriel1997/extensao-chat-gpt-manager/releases/tag/v1.0.0
