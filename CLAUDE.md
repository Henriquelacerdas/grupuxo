# grupuxo — guia para IAs e devs

App iOS SwiftUI de distribuição de tarefas domésticas. Leia [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de mudar contratos e [docs/ALGORITMO.md](docs/ALGORITMO.md) antes de tocar em `Services/` do pacote de domínio.

## Mapa rápido

Código em `grupuxo/grupuxo/` (Xcode project em `grupuxo/grupuxo.xcodeproj`). O domínio vive no Swift Package local `grupuxo/Packages/GrupuxoDomain` (`Sources/GrupuxoDomain/`), importado pelo app com `import GrupuxoDomain`:

- `App/` composição (`AppContainer`), sessão, `RootView`.
- `Packages/GrupuxoDomain` entidades, value objects, repositórios (protocolos), use cases, services (algoritmos). Só `Foundation`, sem SwiftUI. API pública: tipo novo consumido pelo app precisa de `public` e `init` público explícito.
- `Data/Mock/` repositórios mockados sobre um único `MockStore` (actor) e `MockSeed`.
- `Presentation/` `Features/<Nome>/{State,View,ViewModel}`, `Navigation/`, `DesignSystem/`.
- Testes: `grupuxo/grupuxoTests` (app + Mock) e `Packages/GrupuxoDomain/Tests` (domínio puro, `swift test`). Ambos executados. `grupuxo/grupuxo/Tests/` são guias históricos, não rodam.

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
- Mudou contrato compartilhado ou regra de negócio? Atualize os docs no mesmo commit.

## Comandos

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests

# domínio puro
swift test --package-path grupuxo/Packages/GrupuxoDomain
```
