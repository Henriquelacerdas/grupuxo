# grupuxo — guia para IAs e devs

App iOS SwiftUI de distribuição de tarefas domésticas. Leia [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de mudar contratos e [docs/ALGORITMO.md](docs/ALGORITMO.md) antes de tocar em `Domain/Services`.

## Mapa rápido

Código em `grupuxo/grupuxo/` (Xcode project em `grupuxo/grupuxo.xcodeproj`):

- `App/` composição (`AppContainer`), sessão, `RootView`.
- `Domain/` entidades, value objects, repositórios (protocolos), use cases, services (algoritmos). Sem SwiftUI.
- `Data/Mock/` repositórios mockados sobre um único `MockStore` (actor) e `MockSeed`.
- `Presentation/` `Features/<Nome>/{State,View,ViewModel}`, `Navigation/`, `DesignSystem/`.
- Testes: `grupuxo/grupuxoTests` (executados). `grupuxo/grupuxo/Tests/` são guias históricos, não rodam.

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
```
