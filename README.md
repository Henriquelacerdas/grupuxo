# grupuxo

App iOS (SwiftUI) que distribui tarefas domésticas entre moradores de casas compartilhadas e repúblicas, equilibrando o esforço semanal e respeitando a participação de cada um nos cômodos.

**Estado atual:** o app tem login (Amazon Cognito via Amplify, e-mail/senha e Sign in with Apple), mas os dados continuam mockados, sem backend de dados nem sincronização. No app, as regras de distribuição ainda rodam no dispositivo. O login ainda é só uma porta de entrada: o morador exibido vem do `MockSeed`, não da conta autenticada. O backend em Node.js + TypeScript (`backend-ts/`) já tem o domínio e o algoritmo portados, verificados contra o Swift por fixtures de referência, e a integração com o WhatsApp (webhook, worker, vínculo por token e contratos, sem banco nem AWS ainda), conforme [docs/BACKEND.md](docs/BACKEND.md).

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
| [docs/BACKEND.md](docs/BACKEND.md) | Backend Node.js + TypeScript, banco PostgreSQL, WhatsApp, autenticação e estado da implementação em `backend-ts/` |
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

A suíte do app fica em `grupuxo/grupuxoTests`. O domínio Swift puro roda com SwiftPM:

```sh
swift test --package-path grupuxo/Packages/GrupuxoDomain
```

O backend TypeScript (Node 22.18 ou superior) tem testes unitários, de contrato e fixtures de referência geradas a partir do domínio Swift:

```sh
cd backend-ts
npm install          # só dev-dependencies (typescript e @types/node)
npm run typecheck
npm test
```

Para regenerar as fixtures depois de mudar o algoritmo (precisa do toolchain Swift): `backend-ts/tools/swift-fixtures/regenerate.sh`.

## Roadmap

Ver "Roadmap e decisões abertas" em [docs/PRODUTO.md](docs/PRODUTO.md).
