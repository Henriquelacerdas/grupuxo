# grupuxo

App iOS (SwiftUI) que distribui tarefas domésticas entre moradores de casas compartilhadas e repúblicas, equilibrando o esforço semanal e respeitando a participação de cada um nos cômodos.

**Estado atual:** dados mockados, sem login, backend ou sincronização. Todas as regras de distribuição rodam no dispositivo. Integração com o WhatsApp dos moradores está planejada e ainda não implementada.

## Funcionalidades

- **Minhas tarefas:** tarefas atribuídas ao usuário, conclusão e pedido de troca com outro morador.
- **Gerenciar casa:** cômodos (comuns e privados), criação/edição de tarefas, sugestões de tarefas por tipo de cômodo e card de tarefas esporádicas.
- **Distribuição automática:** rotação por calendário ou por conclusão, com fila otimizada pelo Algoritmo Húngaro e saldo de justiça.
- **Entrada e saída** de moradores na casa e nos cômodos, com reequilíbrio a partir da próxima segunda-feira.
- **Notificações** (trocas de tarefa) e **Configurações** (moradores da casa).

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/PRODUTO.md](docs/PRODUTO.md) | Regras de produto: casa, cômodos, tarefas, férias, avaliação, roadmap |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Camadas, estrutura de pastas, navegação, repositórios, concorrência, convenções |
| [docs/ALGORITMO.md](docs/ALGORITMO.md) | Contrato matemático da distribuição: custo, Húngaro, calendário, invariantes |
| [CLAUDE.md](CLAUDE.md) | Guia rápido para IAs e novos desenvolvedores |

## Rodando

Requisitos: Xcode com o SDK e o runtime iOS 26.5 (deployment target do app: iOS 26.5, Swift 6).

1. Abra `grupuxo/grupuxo.xcodeproj`.
2. Selecione o scheme `grupuxo` e um simulador iPhone.
3. Execute (⌘R). Os dados de demonstração são gerados na inicialização por `MockSeed`.

## Testes

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
```

A suíte executável fica em `grupuxo/grupuxoTests`.

## Roadmap

Ver "Roadmap e decisões abertas" em [docs/PRODUTO.md](docs/PRODUTO.md).
