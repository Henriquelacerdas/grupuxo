# grupuxo

App iOS (SwiftUI) que distribui tarefas domésticas entre moradores de casas compartilhadas e repúblicas, equilibrando o esforço semanal e respeitando a participação de cada um nos cômodos.

**Estado atual:** o app tem login (Amazon Cognito via Amplify, e-mail/senha e Sign in with Apple), mas os dados continuam mockados, sem backend de dados nem sincronização. Todas as regras de distribuição rodam no dispositivo. O login ainda é só uma porta de entrada: o morador exibido vem do `MockSeed`, não da conta autenticada. A integração com o WhatsApp está em construção em `backend/` (webhook, worker e contratos, sem banco nem AWS ainda), conforme [docs/BACKEND.md](docs/BACKEND.md).

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
| [docs/BACKEND.md](docs/BACKEND.md) | Backend AWS, banco PostgreSQL, WhatsApp, autenticação e estado da implementação em `backend/` |
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

A suíte do app fica em `grupuxo/grupuxoTests`. Domínio puro e backend rodam com SwiftPM:

```sh
swift test --package-path grupuxo/Packages/GrupuxoDomain
swift test --package-path backend
```

Para conferir que domínio e backend compilam em Linux (destino das Lambdas), com Docker:

```sh
docker build -f backend/Dockerfile -t grupuxo-backend .
docker run --rm grupuxo-backend
```

## Roadmap

Ver "Roadmap e decisões abertas" em [docs/PRODUTO.md](docs/PRODUTO.md).
