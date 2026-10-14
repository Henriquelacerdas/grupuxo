# Arquitetura

## Visão geral

Clean Architecture com SwiftUI + MVVM na apresentação, com o domínio num Swift Package local (`Packages/GrupuxoDomain`) e Data/Presentation/App no target do app (camadas como pastas). Swift 6 com concorrência estrita; deployment target iOS 26.5.

O app fala com a `api` do servidor (`backend/`, ver [BACKEND.md](BACKEND.md)) por `Data/Remote`: o login (Cognito via Amplify Auth) dá o access token, e casa, cômodos, moradores, código de convite, tarefas, ocorrências e o vínculo do WhatsApp são do servidor, persistidos no DynamoDB. A escala é calculada no servidor pelo domínio TypeScript, o mesmo que atende o WhatsApp, então app e bot veem a mesma casa. O `GrupuxoDomain` Swift continua sendo a **referência** do algoritmo (fixtures de comparação) e roda on-device só nos testes e nos repositórios `Mock*` que ainda alimentam trocas e notificações (sem rota na `api`; telas escondidas). Trocar mocks por integrações reais não deve exigir mudanças em Views ou no domínio.

| Camada | Responsabilidade | Depende de |
| --- | --- | --- |
| Domain | Entidades, regras, casos de uso, contratos de repositório, serviços algorítmicos | nada |
| Data | Implementações de repositório: `Remote*` (a `api`) e `Mock*` (testes, trocas e notificações) | Domain |
| Presentation | Views, ViewModels, navegação, design system | Domain |
| App | Inicialização, sessão, composição de dependências (`AppContainer`) | todas |

Fluxo de uma ação: View → ViewModel → UseCase → Repository → implementação em Data.

## Estrutura de pastas

App: `grupuxo/grupuxo/`. Domínio: `grupuxo/Packages/GrupuxoDomain/Sources/GrupuxoDomain/` (importado com `import GrupuxoDomain`).

```
App/            DomesticApp, AppContainer, AppSession, RootView
GrupuxoDomain (pacote)/
  Entities/     User, House, HouseMembership, Room, RoomMembership, RoomAccessRequest,
                TaskDefinition, TaskOccurrence, TaskAssignment, TaskSuggestion,
                TaskSwapRequest, AppNotification, Absence
  ValueObjects/ ValueObjects, RoomAppearance
  Repositories/ House, Room, Task, TaskSwap, Notification
  UseCases/     um arquivo por caso de uso
  Services/     algoritmos e políticas (ver abaixo)
  Errors/       DomainError
Data/Remote/    APIClient, APIConfiguration, AmplifyAccessTokenProvider, RemoteDTO,
                Remote{House,Room,Task,WhatsAppConnection}Repository, RemoteHouseSession
Data/Mock/      MockStore (actor), MockSeed, Mock*Repository (testes; trocas e notificações no app)
Data/Auth/      AuthService (Amplify/Cognito: login, cadastro, confirmação, redefinição de senha, Apple, sessão)
grupuxo/amplify/ só `auth` (referenceAuth do user pool existente); não é implantado pelo app
grupuxo/package.json toolchain `ampx` (não entra no app)
Presentation/
  Features/     MyTasks, HouseManagement, RoomDetail, RoomEditor, TaskEditor,
                SporadicTasks, TaskSwap   (cada uma: State + View + ViewModel)
                Profile (só os arquivos de vínculo do WhatsApp, sem tela: a seção está escondida)
                Auth (LoginView, SignUpView, ConfirmSignUpView, ForgotPasswordView; sem ViewModel, usam AuthService)
                HouseManagement também tem HouseGateView, OnboardingView e HouseView (sem ViewModel: usam RemoteHouseSession)
  Navigation/   AppRoute, AppRouter
  DesignSystem/ DesignSystem, RoomIconView
```

Testes executáveis: `grupuxo/grupuxoTests` (target do app, usa Mock; `@testable import GrupuxoDomain`) e `Packages/GrupuxoDomain/Tests` (domínio puro: Húngaro, motor, justiça; `swift test`). `backend/test` cobre o domínio portado (cenários equivalentes aos do Swift, comparação com fixtures geradas do Swift), webhook (assinatura, verificação, filtragem), worker (idempotência, vínculo) e o contrato dos ports (`npm test` em `backend`). `grupuxo/grupuxo/Tests/` contém apenas guias históricos e não roda. DTOs e mappers da `api` ficam em `Data/Remote`; `RemoteAPITests` decodifica os mesmos JSON de `backend/test/fixtures/api/` que o teste TS grava.

### Serviços de domínio

| Serviço | Papel |
| --- | --- |
| `TaskSchedulingService` | Transições transacionais: criar, concluir, estender horizonte, entrar/sair de cômodo |
| `TaskDistributionEngine` | Matriz de custo semanal e fila inicial via Húngaro |
| `HungarianAlgorithm` | Solucionador puro sobre `[[Double]]` |
| `HouseQueueOptimizer` | Reequilíbrio da casa em entradas/saídas |
| `RoomScheduling` | Escala do cômodo: períodos, blocos gulosos, versões |
| `RotationCalculator` | Datas e ocorrências do calendário |
| `FairnessCalculator` | Saldo de justiça |
| `WeeklyLoadCalculator` | Carga semanal por usuário |
| `TaskEligibilityPolicy`, `TaskSwapEligibilityPolicy` | Quem pode ver, concluir, oferecer e receber |
| `TaskSuggestionCatalog` | Sugestões de tarefa por categoria de cômodo |

Contrato matemático completo: [ALGORITMO.md](ALGORITMO.md).

### Backend (`backend/`)

Projeto Node.js (22.18 ou superior) com TypeScript `strict`, ESM e **nenhuma dependência de runtime** (HMAC, SHA-256, aleatoriedade e UUID vêm de `node:crypto`; testes com `node:test`). Detalhes em [BACKEND.md](BACKEND.md).

```
backend/
  src/domain/            port do GrupuxoDomain; puro (sem node:*, sem I/O, sem relógio global)
    entities.ts value-objects.ts ids.ts errors.ts dates.ts store-state.ts repositories.ts
    services/            Húngaro, motor, otimizador da casa, agendamento, justiça, carga, elegibilidade, sugestões
    commands/            tarefas, casa, cômodos, trocas, notificações: funções (estado, entrada) → estado
    use-cases/           um por caso de uso (classes com execute)
  src/whatsapp/          webhook/ (payload, assinatura, handler), worker, linking/ (token e vínculo), ports
  src/assistant/         Gemini: cliente, ferramentas de leitura e responder
  src/auth/              JWT do Cognito (TokenVerifier, JWKS) e UserDirectory
  src/lambdas/           handlers webhook, worker e api (rotas da §6.1), config e composição
  src/main/              pontos de entrada das Lambdas: única camada com process.env, relógio e AWS SDK
  src/adapters/in-memory/  store transacional, repositórios, ports do WhatsApp e seed (testes)
  src/adapters/dynamodb/ persistência real (tabela única, bloqueio otimista por casa)
  src/adapters/aws/      SQS FIFO e Secrets Manager sobre clientes mínimos
  infra/                 Terraform do ambiente dev
  tools/seed-dev/        casa de demonstração e link de vínculo (só com autorização)
  test/                  testes; contract/ (contratos dos ports); fixtures/ (casos dourados do Swift)
  tools/swift-fixtures/  gerador das fixtures (SwiftPM, depende do GrupuxoDomain)
```

Diferenças deliberadas em relação ao Swift:

- **A lógica transacional sai dos repositórios.** No app ela está nos `Mock*Repository` (acesso, claim/release, trocas, entrada/saída de casa). No TypeScript ela vive em `domain/commands/` como funções puras sobre o estado, e o adaptador só faz `store.update(estado => comando(...))`. Assim o adaptador DynamoDB carrega o estado da casa, chama o mesmo comando e grava a diferença, sem reimplementar regras.
- **Relógio e IDs injetados.** Nada no domínio lê o relógio nem gera UUID: `now` e `newID` entram por construtor (`CommandContext`, `TaskSchedulingService`, casos de uso).
- **Fuso por casa.** `House.timezone` (IANA) é campo do domínio TypeScript; o calendário do serviço de agendamento é montado a partir dele. O Swift recebe o `Calendar` por injeção e não guarda o fuso na casa.
- **Imutabilidade.** Entidades são `readonly` e atualizadas por cópia. O `SchedulingState` é um objeto com arrays que o serviço altera por substituição de elementos; copiar os arrays (`cloneSchedulingState`, `cloneStoreState`) é uma cópia por valor correta porque entidades nunca mudam no lugar.

## Navegação e fluxo de produto

Com uma casa ativa na sessão, o app tem duas abas (`AppTab`: `myTasks`, `house`). Sino e perfil, no canto superior direito, abrem notificações e configurações.

- **Minhas tarefas** apenas consulta e age sobre ocorrências existentes (concluir, trocar). Sem botão, menu, atalho ou rota de criação.
- **Gerenciar casa** contém criação de cômodos e tarefas, e o card de esporádicas (que não têm aba própria).
- `TaskEditor` abre pela criação em Gerenciar casa ou pela manutenção dentro de um cômodo. Sem cômodo pré-selecionado, exige escolher um `roomID` antes de salvar.
- `settings` (engrenagem/perfil) abre o `HouseView`: código de convite, cômodos e moradores, conectar o WhatsApp (`WhatsAppConnectionSection` sobre `RemoteWhatsAppConnectionRepository`), sair da casa e sair da conta.
- Rotas (`AppRoute`) são tipadas e carregam só identificadores: `roomDetail`, `sporadicTasks`, `taskEditor(roomID:)`, `taskSwap(offeredOccurrenceID:)`, `notifications`, `settings`. Existir uma rota não autoriza qualquer tela a apresentá-la.

## Casa e conta no servidor

`ContentView` → `LoginView` (Amplify Auth) → `HouseGateView`, que carrega a `RemoteHouseSession`: `POST /v1/me` com o nome (idempotente) e `GET /v1/me` dão o `User.id` do **backend** (o `sub` do Cognito fica mapeado no servidor por `COGNITO#<sub>`; o app não usa o `sub` como id), e `GET /v1/me/house` dá a casa. Sem casa, `OnboardingView` cria (`POST /v1/houses`) ou entra por código (`POST /v1/houses/join`); sair é `DELETE /v1/me/house`. Depois, `RootView` monta o `AppContainer` com os repositórios remotos. Contrato completo em [BACKEND.md](BACKEND.md) §6.1.

- Toda requisição leva o **access token** do Cognito (`AmplifyAccessTokenProvider`); 401 desloga. O servidor tira o morador do token, nunca do corpo, e usa o próprio relógio (`requestedBy`/`at` dos casos de uso são ignorados pelos repositórios remotos).
- Rota que não existe na `api` lança `APIError.unsupported`; as telas que dependem dela ficam escondidas (trocas, notificações, esporádicas, edição de tarefa, renomear/excluir cômodo, morador sem conta).
- O endereço vem do build setting `GRUPUXO_API_BASE_URL` (→ `Info.plist`, `APIConfiguration`); sem valor ou com `CONFIGURE-ME`, o app recusa falar com qualquer servidor.
- O Amplify Data (AppSync) chegou a ser escrito e foi abandonado antes de qualquer deploy ([PLANO.md](PLANO.md), D1): a casa tem um dono só, o backend.

## Modelo de dados

Structs para entidades/valores, enums para estados e políticas, IDs estáveis nos relacionamentos. Não duplicar entidades por tela.

| Modelo | Representa |
| --- | --- |
| `User` | Identidade; e-mail opcional |
| `House` | Casa, código de acesso, criação |
| `HouseMembership` | Participação na casa |
| `Room` | Cômodo: visibilidade, periodicidade, responsáveis, versões da escala |
| `RoomMembership` | Participação no cômodo: `leftAt`, `rotationChanges`, `fairnessDebt` |
| `TaskDefinition` | Regra: esforço, agenda, fila rotativa, `pendingRotation` |
| `TaskOccurrence` | Execução pendente ou histórica, com `effortSnapshot` |
| `TaskAssignment` | Histórico de responsáveis (`assignedAt`, `endedAt`, `supersededAt`) |
| `TaskSwapRequest` | Pedido de troca entre duas ocorrências (pending/accepted/rejected) |
| `AppNotification` | Notificação de troca para um usuário, com `readAt` |
| `Absence` | Férias de uma participação, `[startsAt, endsAt)` |

Regras estruturais:

- Toda tarefa, inclusive esporádica, tem `roomID`; `houseID` é derivado do cômodo.
- Alterar uma `TaskDefinition` nunca reescreve ocorrências passadas.
- Exceção destrutiva: excluir cômodo e tarefas na confirmação da última saída.
- `TaskAssignment.supersededAt` preserva planos futuros substituídos.
- Vínculos de cômodo são mantidos na saída (preservam saldo); consultas filtram por acesso atual e liberam só as pendências do ex-participante.

## Casos de uso

ViewModels acessam o domínio apenas por casos de uso.

- **Tarefas:** `GetMyTasks`, `GetRoomTasks`, `GetSporadicTasks`, `GetTaskSuggestions`, `CreateTask`, `CompleteTask`, `ClaimSporadicTask`, `ReleaseSporadicTask`, `RefreshTaskSchedule`
- **Cômodos:** `GetHouseRooms`, `GetRoomParticipation`, `CreateRoom`, `AddRoomMember`, `RemoveRoomMember`
- **Casa:** `GetHouseMembers`, `AddHouseMember`, `RemoveHouseMember`
- **Encerrar tarefa:** `EndTask` (`TaskRepository.endTask(_:requestedBy:at:)`; `TaskSchedulingService.endTask` no Swift e `endTask` em `domain/commands/tasks.ts` no servidor). Substituiu o antigo `DeleteTask`, que apagava também o histórico. Exige morador da casa e participante atual do cômodo, mantém a ocorrência da vez e o histórico, remove só as futuras e recusa as trocas pendentes que as citam (regras em [ALGORITMO.md](ALGORITMO.md)). No servidor o repositório recebe o `roomID` (o DynamoDB não indexa definições); a UI chama de "Encerrar".
- **Troca:** `GetTaskSwapCandidates`, `CreateTaskSwapRequest`, `AcceptTaskSwapRequest`, `RejectTaskSwapRequest`, `GetIncomingTaskSwapRequests`, `GetOutgoingTaskSwapRequests`
- **Notificações:** `GetNotifications`, `MarkNotificationAsRead`

Casos de uso coordenam; matemática reutilizável fica nos serviços. Calculadores recebem tipos primitivos e a data de referência, são determinísticos e não acessam UI, banco nem sessão.

`CreateTask`, `CompleteTask`, `RefreshTaskSchedule`, `AddRoomMember` e `RemoveRoomMember` são fachadas assíncronas de comandos transacionais: não leem dados antes da gravação. `CreateRoom` valida a composição completa dos comuns. `RemoveRoomMember` exige confirmação explícita para a última saída. `AddHouseMember`/`RemoveHouseMember` fazem um único replanejamento e um commit atômico.

## Repositórios e transações

Protocolos em Domain; implementações em Data. Operações usam `async throws` desde os mocks e expõem ações de negócio (concluir, assumir, devolver), não `save/delete` genéricos.

Todos os repositórios mock compartilham um `MockStore` (actor). `MockSeed` gera a demonstração com o mesmo planejador dos comandos reais.

`create`, `complete`, `refreshSchedule`, `addMember` e `removeMember` executam o `TaskSchedulingService` **dentro** de `MockStore.update`, que:

1. trabalha em uma cópia do estado;
2. publica somente se a closure termina com sucesso (rollback em qualquer erro);
3. não tem suspensão (`await`) entre validação e commit.

Isso impede ler participantes/carga, calcular o Húngaro e gravar sobre um snapshot desatualizado. Onde o cálculo roda é decisão de Data; a matemática continua em Domain e testável isoladamente.

No backend TypeScript o equivalente é `InMemoryStore.update(fn)` (`src/adapters/in-memory/store.ts`): `fn` é síncrona, trabalha numa cópia do estado e só a publica se termina sem erro (testes de rollback e de concorrência com `Promise.all`). O repositório DynamoDB (`src/adapters/dynamodb/`) faz o mesmo com bloqueio otimista por casa: carrega a partição, roda o comando sobre a cópia e grava a diferença num `TransactWriteItems` condicionado ao `version` da casa, repetindo se outro pedido gravou no meio (ver [BACKEND.md](BACKEND.md), seção 4).

Consultas resolvem a casa pelo cômodo e aplicam elegibilidade antes de devolver dados. Repositórios omitem as versões de escala de cômodos privados para não participantes (contêm IDs de tarefas).

Conclusão e atribuição são idempotentes: repetir não duplica esforço, responsáveis nem `FairnessDebt`. Um backend real deve prover transação ou controle otimista de versão equivalente e ser a autoridade de autorização; a UI nunca é.

## Apresentação e concorrência

- ViewModels: `@MainActor`, recebem casos de uso pelo init, controlam carregamento, conteúdo, vazio e erro.
- Views renderizam estado e encaminham ações; sem cálculo de distribuição e sem acesso a repositórios.
- Após mutações, recarregar as consultas afetadas (e também ao voltar à tela).
- `AppContainer` cria e injeta solucionador, motor, calculadores, calendário, serviços, repositórios e ViewModels. `AppSession` guarda usuário e casa atuais; o contexto é passado explicitamente aos casos de uso.
- Isolamento padrão `nonisolated` (Domain/Data não pertencem à UI). `@MainActor` explícito em ViewModels, sessão, roteador e composição. O processamento síncrono pesado roda no actor do store: sem `Task.detached`, sem actor matemático, sem `@unchecked Sendable`.

## Autenticação e WhatsApp

- Login (e-mail/senha e Sign in with Apple pelo Hosted UI do Cognito) vive em `Data/Auth/AuthService`, sem contrato de autenticação no Domain. A UI funciona sem imagem (iniciais/avatar).
- A integração com WhatsApp vive no backend TypeScript (`src/whatsapp/`, ports em `ports.ts`); o app só pede o link de vínculo (`POST /v1/me/whatsapp/link`), mostra o estado (`GET /v1/me/whatsapp`) e desconecta (`DELETE /v1/me/whatsapp`), na seção de WhatsApp do `HouseView`. Pelo WhatsApp o morador vê as próprias tarefas e conclui uma depois de confirmar com "sim". Proposta e estado: [BACKEND.md](BACKEND.md).

## Convenções

- Tipos e propriedades em inglês; textos de interface em português.
- Domain (pacote) importa só `Foundation`; nada de SwiftUI nem persistência. O que o app consome é `public` (structs com `init` público explícito). No TypeScript, `src/domain/` não importa `node:*` (verificado por teste).
- ViewModels não instanciam repositórios concretos; sem `Singleton.shared`.
- Regras de negócio e balanceamento não ficam em Views/ViewModels.
- Testar o Húngaro isoladamente, com matrizes de resposta conhecida.
- Mudou o algoritmo? Altere o Swift (referência) e o TypeScript, regenere as fixtures e rode as duas suítes (ver `CLAUDE.md`).
- Alterou contrato compartilhado? Atualize estes documentos.
