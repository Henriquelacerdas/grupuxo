# Arquitetura

## Visão geral

Clean Architecture com SwiftUI + MVVM na apresentação, com o domínio num Swift Package local (`Packages/GrupuxoDomain`) e Data/Presentation/App no target do app (camadas como pastas). Swift 6 com concorrência estrita; deployment target iOS 26.5.

Hoje os dados do app rodam sobre repositórios mockados. O login (Cognito via Amplify) existe, mas só controla o acesso à interface: a sessão (`AppSession`) ainda usa o usuário do `MockSeed`. No app, a distribuição de tarefas ainda roda on-device. O backend em Node.js + TypeScript (`backend-ts/`, ver [BACKEND.md](BACKEND.md)) tem uma **segunda implementação** do domínio e do algoritmo, portada do `GrupuxoDomain` e verificada contra ele por fixtures de referência: é ela que vai calcular a escala no servidor (WhatsApp, Android e, depois, o próprio app). Enquanto o app usar o mock, o `GrupuxoDomain` Swift é o domínio do app e a **referência** do port. Trocar mocks por integrações reais não deve exigir mudanças em Views ou no domínio.

| Camada | Responsabilidade | Depende de |
| --- | --- | --- |
| Domain | Entidades, regras, casos de uso, contratos de repositório, serviços algorítmicos | nada |
| Data | Implementações de repositório (hoje `Mock*`) e futuras integrações | Domain |
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
Data/Mock/      MockStore (actor), MockSeed, Mock{House,Room,Task,TaskSwap,Notification}Repository
Data/Auth/      AuthService (Amplify/Cognito: login, cadastro, confirmação, Apple, sessão)
Presentation/
  Features/     MyTasks, HouseManagement, RoomDetail, RoomEditor, TaskEditor,
                SporadicTasks, TaskSwap, Profile   (cada uma: State + View + ViewModel)
                Auth (LoginView, SignUpView, ConfirmSignUpView; sem ViewModel, usam AuthService)
  Navigation/   AppRoute, AppRouter
  DesignSystem/ DesignSystem, RoomIconView
```

Testes executáveis: `grupuxo/grupuxoTests` (target do app, usa Mock; `@testable import GrupuxoDomain`) e `Packages/GrupuxoDomain/Tests` (domínio puro: Húngaro, motor, justiça; `swift test`). `backend-ts/test` cobre o domínio portado (cenários equivalentes aos do Swift, comparação com fixtures geradas do Swift), webhook (assinatura, verificação, filtragem), worker (idempotência, vínculo) e o contrato dos ports (`npm test` em `backend-ts`). `grupuxo/grupuxo/Tests/` contém apenas guias históricos e não roda. Quando houver `Data/Remote`, criar DTOs e mappers ali.

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

### Backend (`backend-ts/`)

Projeto Node.js (22.18 ou superior) com TypeScript `strict`, ESM e **nenhuma dependência de runtime** (HMAC, SHA-256, aleatoriedade e UUID vêm de `node:crypto`; testes com `node:test`). Detalhes em [BACKEND.md](BACKEND.md).

```
backend-ts/
  src/domain/            port do GrupuxoDomain; puro (sem node:*, sem I/O, sem relógio global)
    entities.ts value-objects.ts ids.ts errors.ts dates.ts store-state.ts repositories.ts
    services/            Húngaro, motor, otimizador da casa, agendamento, justiça, carga, elegibilidade, sugestões
    commands/            tarefas, casa, cômodos, trocas, notificações: funções (estado, entrada) → estado
    use-cases/           um por caso de uso (classes com execute)
  src/whatsapp/          webhook/ (payload, assinatura, handler), worker, linking/ (token e vínculo), ports
  src/adapters/in-memory/  store transacional, repositórios, ports do WhatsApp e seed (dev e testes)
  test/                  testes; contract/ (contratos dos ports); fixtures/ (casos dourados do Swift)
  tools/swift-fixtures/  gerador das fixtures (SwiftPM, depende do GrupuxoDomain)
```

Diferenças deliberadas em relação ao Swift:

- **A lógica transacional sai dos repositórios.** No app ela está nos `Mock*Repository` (acesso, claim/release, trocas, entrada/saída de casa). No TypeScript ela vive em `domain/commands/` como funções puras sobre o estado, e o adaptador só faz `store.update(estado => comando(...))`. Assim o adaptador PostgreSQL carrega o estado da casa, chama o mesmo comando e grava, sem reimplementar regras.
- **Relógio e IDs injetados.** Nada no domínio lê o relógio nem gera UUID: `now` e `newID` entram por construtor (`CommandContext`, `TaskSchedulingService`, casos de uso).
- **Fuso por casa.** `House.timezone` (IANA) é campo do domínio TypeScript; o calendário do serviço de agendamento é montado a partir dele. O Swift recebe o `Calendar` por injeção e não guarda o fuso na casa.
- **Imutabilidade.** Entidades são `readonly` e atualizadas por cópia. O `SchedulingState` é um objeto com arrays que o serviço altera por substituição de elementos; copiar os arrays (`cloneSchedulingState`, `cloneStoreState`) é uma cópia por valor correta porque entidades nunca mudam no lugar.

## Navegação e fluxo de produto

Com uma casa ativa na sessão, o app tem duas abas (`AppTab`: `myTasks`, `house`). Sino e perfil, no canto superior direito, abrem notificações e configurações.

- **Minhas tarefas** apenas consulta e age sobre ocorrências existentes (concluir, trocar). Sem botão, menu, atalho ou rota de criação.
- **Gerenciar casa** contém criação de cômodos e tarefas, e o card de esporádicas (que não têm aba própria).
- `TaskEditor` abre pela criação em Gerenciar casa ou pela manutenção dentro de um cômodo. Sem cômodo pré-selecionado, exige escolher um `roomID` antes de salvar.
- Rotas (`AppRoute`) são tipadas e carregam só identificadores: `roomDetail`, `sporadicTasks`, `taskEditor(roomID:)`, `taskSwap(offeredOccurrenceID:)`, `notifications`, `settings`. Existir uma rota não autoriza qualquer tela a apresentá-la.

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

No backend TypeScript o equivalente é `InMemoryStore.update(fn)` (`src/adapters/in-memory/store.ts`): `fn` é síncrona, trabalha numa cópia do estado e só a publica se termina sem erro (testes de rollback e de concorrência com `Promise.all`). O repositório PostgreSQL fará o mesmo com `BEGIN` + bloqueio por casa + `COMMIT` (ver [BACKEND.md](BACKEND.md), seção 4).

Consultas resolvem a casa pelo cômodo e aplicam elegibilidade antes de devolver dados. Repositórios omitem as versões de escala de cômodos privados para não participantes (contêm IDs de tarefas).

Conclusão e atribuição são idempotentes: repetir não duplica esforço, responsáveis nem `FairnessDebt`. Um backend real deve prover transação ou controle otimista de versão equivalente e ser a autoridade de autorização; a UI nunca é.

## Apresentação e concorrência

- ViewModels: `@MainActor`, recebem casos de uso pelo init, controlam carregamento, conteúdo, vazio e erro.
- Views renderizam estado e encaminham ações; sem cálculo de distribuição e sem acesso a repositórios.
- Após mutações, recarregar as consultas afetadas (e também ao voltar à tela).
- `AppContainer` cria e injeta solucionador, motor, calculadores, calendário, serviços, repositórios e ViewModels. `AppSession` guarda usuário e casa atuais; o contexto é passado explicitamente aos casos de uso.
- Isolamento padrão `nonisolated` (Domain/Data não pertencem à UI). `@MainActor` explícito em ViewModels, sessão, roteador e composição. O processamento síncrono pesado roda no actor do store: sem `Task.detached`, sem actor matemático, sem `@unchecked Sendable`.

## Autenticação, perfil e WhatsApp (futuro)

- Sign in with Apple ficará em Data atrás de um contrato de autenticação em Domain. A UI funciona sem imagem (iniciais/avatar).
- A integração com WhatsApp vive no backend TypeScript (`src/whatsapp/`, ports em `ports.ts`); o app só vai precisar do endpoint de vínculo (`POST /me/whatsapp/link`) e de uma tela no Perfil. Proposta e estado: [BACKEND.md](BACKEND.md).

## Convenções

- Tipos e propriedades em inglês; textos de interface em português.
- Domain (pacote) importa só `Foundation`; nada de SwiftUI nem persistência. O que o app consome é `public` (structs com `init` público explícito). No TypeScript, `src/domain/` não importa `node:*` (verificado por teste).
- ViewModels não instanciam repositórios concretos; sem `Singleton.shared`.
- Regras de negócio e balanceamento não ficam em Views/ViewModels.
- Testar o Húngaro isoladamente, com matrizes de resposta conhecida.
- Mudou o algoritmo? Altere o Swift (referência) e o TypeScript, regenere as fixtures e rode as duas suítes (ver `CLAUDE.md`).
- Alterou contrato compartilhado? Atualize estes documentos.
