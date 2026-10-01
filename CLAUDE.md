# grupuxo — guia para IAs e devs

App iOS SwiftUI de distribuição de tarefas domésticas, mais um backend em Swift (`backend/`) em construção para o canal WhatsApp. Leia [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de mudar contratos, [docs/ALGORITMO.md](docs/ALGORITMO.md) antes de tocar em `Services/` do pacote de domínio e [docs/BACKEND.md](docs/BACKEND.md) antes de mexer em `backend/`.

## Mapa rápido

Código em `grupuxo/grupuxo/` (Xcode project em `grupuxo/grupuxo.xcodeproj`). O domínio vive no Swift Package local `grupuxo/Packages/GrupuxoDomain` (`Sources/GrupuxoDomain/`), importado pelo app com `import GrupuxoDomain`:

- `App/` composição (`AppContainer`), sessão, `RootView`.
- `Packages/GrupuxoDomain` entidades, value objects, repositórios (protocolos), use cases, services (algoritmos). Só `Foundation`, sem SwiftUI. API pública: tipo novo consumido pelo app precisa de `public` e `init` público explícito.
- `Data/Mock/` repositórios mockados sobre um único `MockStore` (actor) e `MockSeed`.
- `Data/Auth/AuthService` login com Amplify/Cognito (e-mail/senha e Apple). `ContentView` escolhe entre `LoginView` e `RootView`; o usuário da sessão ainda vem do mock.
- `backend/` Swift Package do servidor, importa `GrupuxoDomain` por caminho local: `WhatsAppCore` (webhook, worker, ports) e `WhatsAppInMemory` (adaptadores para dev e testes). Sem AWS, sem banco, sem Gemini ainda.
- `Presentation/` `Features/<Nome>/{State,View,ViewModel}`, `Navigation/`, `DesignSystem/`.
- Testes: `grupuxo/grupuxoTests` (app + Mock) e `Packages/GrupuxoDomain/Tests` (domínio puro, `swift test`). Todos executados, mais `backend/Tests` (`swift test --package-path backend`). `grupuxo/grupuxo/Tests/` são guias históricos, não rodam.

Fluxo: View → ViewModel → UseCase → Repository → Data.

## Regras

- Tipos e propriedades em inglês; textos de interface em português.
- Domain não importa SwiftUI nem persistência. ViewModels (`@MainActor`) recebem use cases por init, nunca repositórios concretos.
- Sem `Singleton.shared`; dependências criadas em `AppContainer`.
- Lógica de distribuição, carga e balanceamento nunca em Views/ViewModels.
- Swift 6 com concorrência estrita: sem `Task.detached` nem `@unchecked Sendable` para contornar erros.
- Toda mutação de escala roda **dentro** de `MockStore.update` (cópia + commit + rollback), sem `await` no meio.
- Definição (`TaskDefinition`) e ocorrência (`TaskOccurrence`) são separadas; alterar a definição não reescreve o histórico.
- Criar tarefa só existe em Gerenciar casa, nunca em Minhas tarefas.
- Esforço (1–3) é carga interna: não exibir como pontuação ou gamificação.
- O domínio e o backend precisam compilar em Linux (as Lambdas rodam lá): ao tocar em `GrupuxoDomain` ou `backend/`, rode a verificação do Docker. Evite APIs exclusivas da Apple (`CryptoKit`, `os`, `UIKit`); o backend usa `swift-crypto`.
- `backend/` só traduz HTTP/WhatsApp em chamadas ao domínio: nenhuma regra de negócio ali. O texto da mensagem do WhatsApp é entrada não confiável; o `userID` vem sempre do vínculo do número, nunca do texto. Não registrar conteúdo de mensagens em log nem persistir além de `wamid` e horários.
- Persistência do backend entra por ports (`InboxStore`, `WhatsAppLinkStore`, `LinkTokenStore`, `MessageQueue`, `WhatsAppSender`); a implementação PostgreSQL deve passar nos mesmos testes de contrato dos adaptadores em memória.
- Segredos (Meta, Gemini) só no AWS Secrets Manager. `amplify_outputs.json` tem IDs públicos do Cognito, não segredos, mas não coloque credenciais nele.
- Mudou contrato compartilhado ou regra de negócio? Atualize os docs no mesmo commit.

## Comandos

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests

# domínio puro
swift test --package-path grupuxo/Packages/GrupuxoDomain

# backend (webhook, worker, ports)
swift test --package-path backend

# build e testes em Linux (destino das Lambdas); contexto = raiz do repositório
docker build -f backend/Dockerfile -t grupuxo-backend . && docker run --rm grupuxo-backend
```
