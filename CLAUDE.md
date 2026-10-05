# grupuxo — guia para IAs e devs

App iOS SwiftUI de distribuição de tarefas domésticas, mais um backend em **Node.js + TypeScript** (`backend/`) que roda o algoritmo de distribuição no servidor e atende o canal WhatsApp. Leia [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de mudar contratos, [docs/ALGORITMO.md](docs/ALGORITMO.md) antes de tocar no algoritmo (Swift ou TypeScript) e [docs/BACKEND.md](docs/BACKEND.md) antes de mexer em `backend/`.

## Mapa rápido

App e domínio Swift: código em `grupuxo/grupuxo/` (Xcode project em `grupuxo/grupuxo.xcodeproj`). O domínio vive no Swift Package local `grupuxo/Packages/GrupuxoDomain` (`Sources/GrupuxoDomain/`), importado pelo app com `import GrupuxoDomain`:

- `App/` composição (`AppContainer`), sessão, `RootView`.
- `Packages/GrupuxoDomain` entidades, value objects, repositórios (protocolos), use cases, services (algoritmos). Só `Foundation`, sem SwiftUI. API pública: tipo novo consumido pelo app precisa de `public` e `init` público explícito.
- `Data/Mock/` repositórios mockados sobre um único `MockStore` (actor) e `MockSeed`.
- `Data/Auth/AuthService` login com Amplify/Cognito (e-mail/senha e Apple). `ContentView` escolhe entre `LoginView` e `RootView`; o usuário da sessão ainda vem do mock.
- `Presentation/` `Features/<Nome>/{State,View,ViewModel}`, `Navigation/`, `DesignSystem/`.

Backend TypeScript: `backend/` (Node 22, ESM, `strict`, **zero dependências de runtime**; dev: `typescript` e `@types/node`; os testes usam `node:test`).

- `src/domain/` domínio puro, port do `GrupuxoDomain`: entidades (`entities.ts`), value objects, erros, repositórios (interfaces), `services/` (algoritmo), `commands/` (a lógica transacional que no app mora nos `Mock*Repository`), `use-cases/`, `dates.ts` (calendário por fuso com `Intl`). Sem `node:*`, sem I/O, sem relógio ou gerador de IDs globais: `now` e `newID` são injetados.
- `src/whatsapp/` webhook (payload, assinatura, handler), worker, vínculo por token (`linking/`) e ports (`ports.ts`).
- `src/auth/` validação do JWT do Cognito (`CognitoJwtVerifier`, só access token; JWKS com cache) e port `UserDirectory`; pode usar `node:crypto`. `src/http.ts`: tipo `HttpFetch` para HTTP de saída injetável.
- `src/adapters/in-memory/` store transacional, repositórios do domínio, adaptadores dos ports do WhatsApp e `seed` de demonstração (dev e testes).
- `test/` testes (`node:test`), `test/contract/` testes de contrato reutilizáveis dos ports, `test/fixtures/` casos dourados gerados do Swift.
- `tools/swift-fixtures/` gerador (SwiftPM) das fixtures, a partir do `GrupuxoDomain`.

Testes Swift: `grupuxo/grupuxoTests` (app + Mock) e `Packages/GrupuxoDomain/Tests` (domínio puro, `swift test`). `grupuxo/grupuxo/Tests/` são guias históricos, não rodam.

Fluxo no app: View → ViewModel → UseCase → Repository → Data. No backend: handler/worker → caso de uso ou comando de domínio → port/repositório → adaptador.

## Duas implementações do algoritmo (Swift e TypeScript)

Enquanto o app usar o mock, o `GrupuxoDomain` Swift continua sendo o domínio do app **e a referência** do TypeScript. Regra de mudança:

- Mudou regra de distribuição, saldo, calendário ou política de elegibilidade? Altere o Swift (referência), altere o TypeScript, **regenere as fixtures** (`backend/tools/swift-fixtures/regenerate.sh`) e rode `npm test`. As fixtures comparam o resultado dos dois com `deepStrictEqual`.
- Fixture divergente: o Swift é a referência até se entender a diferença. Descubra se é bug do port ou comportamento do Swift a registrar em `docs/ALGORITMO.md`; não "conserte" o TypeScript para passar sem entender.
- Quando o app passar a consumir a API do servidor, o `GrupuxoDomain` Swift e o gerador de fixtures saem do caminho e o TypeScript fica como única implementação.

## Regras

- Tipos e propriedades em inglês; textos de interface e respostas do bot em português.
- Domain não importa SwiftUI nem persistência. ViewModels (`@MainActor`) recebem use cases por init, nunca repositórios concretos.
- Sem `Singleton.shared`; dependências criadas em `AppContainer` (Swift) ou passadas por construtor (TypeScript, sem container de DI).
- Lógica de distribuição, carga e balanceamento nunca em Views/ViewModels.
- Swift 6 com concorrência estrita: sem `Task.detached` nem `@unchecked Sendable` para contornar erros.
- Toda mutação de escala roda **dentro** de uma transação com cópia, commit e rollback (`MockStore.update` no Swift, `InMemoryStore.update` no TypeScript), sem `await` no meio.
- Definição (`TaskDefinition`) e ocorrência (`TaskOccurrence`) são separadas; alterar a definição não reescreve o histórico.
- Criar tarefa só existe em Gerenciar casa, nunca em Minhas tarefas.
- Esforço (1–3) é carga interna: não exibir como pontuação ou gamificação.
- TypeScript: `strict` (com `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`), sem `any`, sem `@ts-ignore`/`@ts-expect-error`, sem `as` para forçar tipo em dado externo (use `unknown` e estreitamento escrito à mão). Entidades `readonly` e atualização imutável. Sem Temporal, Luxon, zod, ORM nem bibliotecas utilitárias. Datas só pelo módulo `src/domain/dates.ts` (instantes em milissegundos, calendário por fuso IANA; nunca somar múltiplos de 24 h para andar dias locais).
- Todo desempate do algoritmo é explícito e por ID (texto do UUID em minúsculo); nunca dependa da ordem de `Map`/`Set`/objeto.
- `src/whatsapp/` só traduz HTTP/WhatsApp em chamadas ao domínio: nenhuma regra de negócio ali. O texto da mensagem do WhatsApp é entrada não confiável; o `userID` vem sempre do vínculo do número (ou do token no vínculo), nunca do texto. Na `api`, o `userID` vem sempre do access token do Cognito (via `UserDirectory`), nunca do corpo; ID token é rejeitado e `client_id` é conferido, nunca `aud`. Não registrar conteúdo de mensagens em log nem persistir além de `wamid` e horários.
- Persistência entra por ports (`InboxStore`, `WhatsAppLinkStore`, `LinkTokenStore`, `MessageQueue`, `WhatsAppSender` e as interfaces de repositório do domínio); a implementação PostgreSQL deve passar nos mesmos testes de contrato dos adaptadores em memória (`test/contract`).
- Segredos (Meta, Gemini) só no AWS Secrets Manager. `amplify_outputs.json` tem IDs públicos do Cognito, não segredos, mas não coloque credenciais nele.
- Mudou contrato compartilhado ou regra de negócio? Atualize os docs no mesmo commit.

## Comandos

```sh
# app e domínio Swift (referência)
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
swift test --package-path grupuxo/Packages/GrupuxoDomain

# backend TypeScript (Node >= 22.18; a primeira vez, `npm install` em backend)
cd backend
npm run typecheck        # tsc --noEmit
npm test                 # todos os testes, incluindo as fixtures de referência
npm run test:fixtures    # só as comparações com o Swift
```
