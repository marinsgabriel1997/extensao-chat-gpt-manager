# CLAUDE.md

## Projeto

Extensão Chrome para gerenciar conversas do ChatGPT em massa.

Stack oficial:

- Chrome Extension Manifest V3.
- TypeScript.
- HTML e CSS.
- Web APIs nativas.
- Chrome Extensions APIs.
- Sem framework de UI.

TypeScript também é objetivo de aprendizado. Prefira código explícito, legível e tipado, sem abstrações que escondam conceitos da linguagem sem benefício claro.

## Escopo funcional

O MVP cobre:

- filtrar conversas;
- selecionar conversas granularmente;
- selecionar em massa a partir dos filtros e ajustar a seleção manualmente;
- listar Projetos do ChatGPT;
- mover conversas selecionadas para um Projeto;
- usar um Projeto criado previamente pelo usuário, como `LIXEIRA`, para separar conversas que serão revisadas posteriormente.

Exclusão em massa não faz parte do MVP. O projeto `LIXEIRA` é uma convenção de uso, não um recurso especial criado ou administrado automaticamente pela extensão.

Arquivamento em massa não faz parte do MVP enquanto não houver decisão explícita em contrário.

Não adicionar funcionalidades paralelas por iniciativa própria.

## Modos de trabalho

### Planejamento

- Ler somente código e documentação relevantes.
- Alinhar escopo, requisitos, proposta técnica, riscos e critérios de aceite.
- Criar ou atualizar o plano aplicável quando o trabalho exigir planejamento.
- Não implementar, alterar o estado do projeto ou realizar commit.

### Execução

- Implementar somente o escopo aprovado.
- Respeitar arquitetura, contratos e decisões vigentes.
- Trabalhar de forma incremental e rastreável.
- Executar as validações oficiais disponíveis.
- Não realizar commit sem autorização explícita.

### Revisão

- Trabalhar somente em leitura.
- Auditar código, diff, implementação, plano e critérios de aceite.
- Apontar bugs, lacunas, riscos e desvios de contrato.
- Não alterar código, dados ou documentação.
- Não realizar commit.
Se o modo de trabalho não estiver definido e isso mudar materialmente o que pode ser feito, alinhar com o usuário antes de prosseguir.

## Arquitetura e integração com ChatGPT

A integração usa chamadas internas observadas na aplicação web do ChatGPT. Endpoints, payloads, headers e fluxos internos observados não são contratos estáveis.

- Isolar toda integração com o ChatGPT em uma camada própria.
- Domínio, filtros, seleção e operações em lote não devem depender diretamente de detalhes de endpoints.
- Separar formatos crus da integração dos tipos do domínio.
- Converter dados da integração para modelos do domínio na fronteira da camada de integração.
- Não assumir endpoints, payloads, headers ou autenticação sem observar o comportamento real.
- Não criar bypass de autenticação.
- Não depender de credenciais externas.
- Registrar descobertas e contratos observados em `docs/chatgpt-integration.md`.
- Consultar `docs/chatgpt-integration.md` antes de alterar código que dependa de chamadas internas do ChatGPT.
- Quando o comportamento observado divergir da documentação, identificar o conflito e atualizar a fonte canônica junto da alteração correspondente.

Mudanças de contrato, convenção estrutural ou decisão arquitetural relevante devem ser explicitadas no plano e aprovadas antes da implementação.

## Seleção e operações em lote

- Tratar filtros e seleção como conceitos de domínio independentes da UI e da integração.
- A seleção em massa derivada de filtros deve permitir ajustes manuais posteriores.
- Não perder silenciosamente ajustes manuais de seleção ao atualizar a interface.
- Operações em lote devem atuar sobre uma seleção explícita e determinável.
- Não interpretar seleção vazia como “todas as conversas”.
- Falhas parciais em operações em lote devem ser representadas de forma explícita; não reportar sucesso total quando houver itens não processados.

## Código e nomenclatura

- Usar nomenclatura consistente e o mesmo vocabulário para o mesmo conceito.
- Priorizar código simples, legível e explícito.
- Não adicionar framework de UI.
- Preferir Web APIs e Chrome Extensions APIs nativas quando suficientes.
- Não adicionar dependência de runtime sem necessidade técnica clara e aprovação.
- Usar comentários para explicar contexto ou decisões não evidentes, não para repetir o código.

## Testes e validação

- Definir a estratégia de validação no planejamento.
- Criar ou atualizar testes ao alterar comportamento testável, quando houver infraestrutura de testes aplicável.
- Preservar testes existentes como contratos do comportamento validado.
- Investigar falhas de testes; não alterar expectativas apenas para fazer a implementação passar.
- Executar os comandos oficiais aplicáveis de build, testes e lint existentes no projeto.
- Validar funcionalmente no Chrome quando o resultado depender do ambiente real da extensão.
- Relatar o que foi validado e o que não pôde ser validado.
- Não considerar concluída uma entrega com critérios de aceite aplicáveis pendentes.

## Autoridade das fontes

- Comportamento e processo do agente: `CLAUDE.md`.
- Contratos observados da integração com ChatGPT: `docs/chatgpt-integration.md`.
- Estado atualmente implementado: código atual.
- Estado desejado de uma entrega aprovada: plano vigente.

Não assumir que documentação desatualizada representa o estado atual.

Não assumir que o código atual representa o estado desejado quando existir mudança aprovada em plano.

Quando fontes canônicas entrarem em conflito, identificar o conflito antes de prosseguir.

## Documentação

- Atualizar a documentação relacionada às alterações.
- Não duplicar contratos da integração fora de `docs/chatgpt-integration.md`.
- Manter arquitetura e procedimentos extensos em documentação especializada.

| Documento | Consultar quando |
| --- | --- |
| `docs/chatgpt-integration.md` | Observar, implementar, corrigir ou revisar chamadas internas do ChatGPT, seus formatos ou fluxos. |

## Sincronização de instruções

`AGENTS.md` e `CLAUDE.md` são espelhos normativos.

- O trabalho normal não exige ler `AGENTS.md`.
- Ao editar `CLAUDE.md`, consultar e sincronizar `AGENTS.md`.
- Claude pode editar `AGENTS.md` somente para sincronização normativa.
- Estrutura e redação podem variar, mas significado, limites, fluxo e políticas devem permanecer equivalentes.
- Não criar regra exclusiva em apenas um arquivo sem diferença intencional, explícita e aprovada pelo usuário.

## Restrições

- Não realizar commit sem autorização explícita do usuário.
- Não criar bypass de autenticação do ChatGPT.
- Não depender de credenciais externas para a integração.
- Não acoplar domínio ou seleção aos formatos crus da integração.
- Não adicionar framework de UI.
- Não incluir arquivamento em massa no MVP sem decisão explícita.
- Não incluir exclusão em massa no MVP sem decisão explícita.
