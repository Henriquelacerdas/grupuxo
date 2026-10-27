# grupuxo

App iOS (SwiftUI) que distribui tarefas domésticas entre moradores de casas compartilhadas e repúblicas, equilibrando o esforço semanal e respeitando a participação de cada um nos cômodos.

**Estado atual:** o app tem login (Amazon Cognito via Amplify Auth, e-mail/senha e Sign in with Apple) e, depois do login, cria uma **casa real** ou entra nela por código de convite. Casa, cômodos, tarefas (recorrentes e avulsas), trocas, notificações e o vínculo do WhatsApp vêm da `api` do backend em Node.js + TypeScript (`backend/`), que calcula a escala no servidor e persiste no DynamoDB; o mesmo servidor atende o bot do WhatsApp (webhook, fila SQS, worker e assistente Gemini), então app e bot veem a mesma casa. O ambiente `dev` está implantado na conta AWS 580100736070 (Terraform em `backend/infra/`) e o app (Debug e Release) aponta para ele. O bot usa o número real do WhatsApp (app da Meta publicado em 2026-10-26); falta o teste ponta a ponta com um celular de fora da lista de teste. Ainda não há ambiente `prod`. O `GrupuxoDomain` Swift segue como referência do algoritmo (fixtures) e roda nos testes sobre o `MockStore`. Detalhes em [docs/BACKEND.md](docs/BACKEND.md), [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e o plano em [docs/PLANO.md](docs/PLANO.md).

## Funcionalidades

- **Minhas tarefas:** o ciclo do morador por cômodo, tarefas gerais e tarefas únicas, com conclusão, pedido de troca com outro morador, detalhe da tarefa (próximas vezes, última conclusão) e criação pelo botão "+".
- **Gerenciar casa:** cômodos (comuns e privados, com reordenação), criação de tarefas, sugestões de tarefas por tipo de cômodo e card de tarefas únicas (esporádicas).
- **WhatsApp:** o morador vincula o número por um link `wa.me`, pergunta pelas próprias tarefas e conclui uma depois de confirmar com "sim".
- **Distribuição automática:** rotação por calendário ou por conclusão, com fila otimizada pelo Algoritmo Húngaro e saldo de justiça.
- **Entrada e saída** de moradores na casa e nos cômodos, com reequilíbrio a partir da próxima segunda-feira.
- **Notificações** (trocas de tarefa) e **Configurações** (código de convite, moradores, WhatsApp, sair da casa e da conta).
- **Idioma** segue o do aparelho (português do Brasil e inglês), em `grupuxo/grupuxo/Localizable.xcstrings`.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/PRODUTO.md](docs/PRODUTO.md) | Regras de produto: casa, cômodos, tarefas, férias, avaliação, roadmap |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Camadas, estrutura de pastas, navegação, repositórios, concorrência, convenções |
| [docs/ALGORITMO.md](docs/ALGORITMO.md) | Contrato matemático da distribuição: custo, Húngaro, calendário, invariantes |
| [docs/BACKEND.md](docs/BACKEND.md) | Backend Node.js + TypeScript, banco DynamoDB, WhatsApp, autenticação e estado da implementação em `backend/` |
| [docs/PLANO.md](docs/PLANO.md) | Plano da trilha até o TestFlight externo com WhatsApp, estado da AWS e riscos |
| [docs/LATENCIA.md](docs/LATENCIA.md) | Diagnóstico, correções de latência, benchmark local e validação |
| [docs/VALIDACAO-APIS-REAIS.md](docs/VALIDACAO-APIS-REAIS.md) | Checklist do que validar contra Meta, Gemini e AWS reais |
| [backend/infra/README.md](backend/infra/README.md) | Deploy do ambiente `dev` (Terraform) |
| [CLAUDE.md](CLAUDE.md) | Guia rápido para IAs e novos desenvolvedores |

## Rodando

Requisitos: Xcode com o SDK e o runtime iOS 26.5 (deployment target do app: iOS 26.5, Swift 6).

1. Abra `grupuxo/grupuxo.xcodeproj`.
2. Selecione o scheme `grupuxo` e um simulador iPhone.
3. Execute (⌘R) e entre com uma conta do user pool do Cognito. Sem casa, o app pede para criar uma ou entrar por código.

O app fala com a `api` do `dev`: o endereço está em `grupuxo/Config/Grupuxo.xcconfig` (`GRUPUXO_API_BASE_URL`, versionado; não é segredo, a `api` exige o access token do Cognito). Para apontar para outro servidor, copie `grupuxo/Config/Local.xcconfig.example` para `Local.xcconfig` (fora do git). Sem valor real (`CONFIGURE-ME`) o app falha fechado. `grupuxo/grupuxo/amplify_outputs.json` guarda só os IDs públicos do Cognito (seção `auth`). `ampx sandbox`/`ampx deploy` e qualquer chamada à AWS, à Meta ou ao Gemini exigem autorização explícita do dono do projeto.

## Fluidez e latência

As leituras de casa, tarefas e cômodos agora compartilham um snapshot com cache curto na sessão. Concluir e desmarcar mostram resposta imediata com reversão em falha, e as recargas preservam o conteúdo. A nova rota e as otimizações do backend estão implementadas localmente; o ganho no ambiente real depende da publicação da `api`. Medições reproduzíveis e limites em [docs/LATENCIA.md](docs/LATENCIA.md).

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
cd backend
npm install          # só dev-dependencies (typescript e @types/node)
npm run typecheck
npm test
```

Para regenerar as fixtures depois de mudar o algoritmo (precisa do toolchain Swift): `backend/tools/swift-fixtures/regenerate.sh`.

Build das Lambdas (`npm run build`) e deploy do `dev`: [backend/infra/README.md](backend/infra/README.md).

## Roadmap

Ver "Roadmap e decisões abertas" em [docs/PRODUTO.md](docs/PRODUTO.md).
