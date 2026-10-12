# Arquitetura

## Visão geral

Clean Architecture com SwiftUI + MVVM na apresentação, com o domínio num Swift Package local (`Packages/GrupuxoDomain`) e Data/Presentation/App no target do app (camadas como pastas). Swift 6 com concorrência estrita; deployment target iOS 26.5.

Hoje as **tarefas** do app rodam sobre repositórios mockados. O login (Cognito via Amplify) identifica o morador, e a **casa real** (casa, cômodos, moradores e código de convite) vem do Amplify Data por `HouseService`, uma camada **transitória**: o `RootView` copia essa casa para o `MockStore` (`AppContainer.sync`) e a `AppSession` passa a ter o morador e a casa reais (ver "Casa real (Amplify Data, transitório)" abaixo). No app, a distribuição de tarefas ainda roda on-device. O backend em Node.js + TypeScript (`backend/`, ver [BACKEND.md](BACKEND.md)) tem uma **segunda implementação** do domínio e do algoritmo, portada do `GrupuxoDomain` e verificada contra ele por fixtures de referência: é ela que vai calcular a escala no servidor (WhatsApp, Android e, depois, o próprio app). Enquanto o app usar o mock, o `GrupuxoDomain` Swift é o domínio do app e a **referência** do port. Trocar mocks por integrações reais não deve exigir mudanças em Views ou no domínio.

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
Data/Auth/      AuthService (Amplify/Cognito: login, cadastro, confirmação, redefinição de senha, Apple, sessão)
Data/Amplify/   HouseService (casa real sobre Amplify Data/AppSync) e Models/ (HouseRecord, RoomRecord,
                MemberRecord, InviteCode: formato do modelgen; editados à mão até o próximo deploy)
grupuxo/amplify/ backend Amplify Gen 2 (TypeScript): auth, data (schema), functions/join-house
grupuxo/package.json toolchain `ampx` (não entra no app)
Presentation/
  Features/     MyTasks, HouseManagement, RoomDetail, RoomEditor, TaskEditor,
                SporadicTasks, TaskSwap, Profile   (cada uma: State + View + ViewModel)
                Auth (LoginView, SignUpView, ConfirmSignUpView, ForgotPasswordView; sem ViewModel, usam AuthService)
                HouseManagement também tem HouseGateView, OnboardingView e HouseView (sem ViewModel: usam HouseService)
  Navigation/   AppRoute, AppRouter
  DesignSystem/ DesignSystem, RoomIconView
```

Testes executáveis: `grupuxo/grupuxoTests` (target do app, usa Mock; `@testable import GrupuxoDomain`) e `Packages/GrupuxoDomain/Tests` (domínio puro: Húngaro, motor, justiça; `swift test`). `backend/test` cobre o domínio portado (cenários equivalentes aos do Swift, comparação com fixtures geradas do Swift), webhook (assinatura, verificação, filtragem), worker (idempotência, vínculo) e o contrato dos ports (`npm test` em `backend`). `grupuxo/grupuxo/Tests/` contém apenas guias históricos e não roda. Quando houver `Data/Remote`, criar DTOs e mappers ali.

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
  src/auth/              JWT do Cognito (TokenVerifier, JWKS) e UserDirectory
  src/adapters/in-memory/  store transacional, repositórios, ports do WhatsApp e seed (dev e testes)
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
- `settings` (engrenagem/perfil) abre o `HouseView`: código de convite, cômodos e moradores reais, WhatsApp (`WhatsAppConnectionSection`), sair da casa e sair da conta. O `ProfileView` (moradores do mock) continua no código, mas nenhuma rota o abre.
- Rotas (`AppRoute`) são tipadas e carregam só identificadores: `roomDetail`, `sporadicTasks`, `taskEditor(roomID:)`, `taskSwap(offeredOccurrenceID:)`, `notifications`, `settings`. Existir uma rota não autoriza qualquer tela a apresentá-la.

## Casa real (Amplify Data, transitório)

Decisão ✅ 10 em [BACKEND.md](BACKEND.md): o backend TypeScript (DynamoDB) é a fonte da verdade da casa; o Amplify Data só destrava login + entrada na casa até o app consumir a `api` (`POST /houses`, `POST /houses/join`), e então sai. Consequências: tarefas e escala **não** passam pelo Amplify (ficam no `MockStore`, recriadas a cada abertura); casas criadas aqui **não existem para o bot do WhatsApp** até serem migradas.

Fluxo: `ContentView` → `HouseGateView` (carrega `HouseService`; sem casa mostra `OnboardingView`) → `RootView`, que observa `HouseService` e chama `AppContainer.sync(HouseSnapshot)` para refletir moradores e cômodos reais no `MockStore` (cômodos conhecidos mantêm ícone, cor e participantes; ids que não são UUID viram UUID novo a cada sincronização, então o Cognito `sub` e os ids do Amplify precisam ser UUID).

Modelos (`grupuxo/amplify/data/resource.ts`):

| Modelo | Campos | Observação |
| --- | --- | --- |
| `HouseRecord` | `name`, `ownerId`, `members` | `ownerId` é só informativo; todos os moradores têm o mesmo peso |
| `RoomRecord` | `houseId`, `name`, `members` | índice por `houseId` |
| `MemberRecord` | `houseId`, `userId?`, `name`, `role`, `members` | `userId` vazio = morador sem conta; `role` é sempre `MEMBER`, mantido por compatibilidade |
| `InviteCode` | `houseId`, `members` | o `id` **é** o código (6 caracteres, sem `0/O/1/I`); o AppSync recusa criar um id existente, o que garante a unicidade |

**Autorização por morador.** Cada registro da casa guarda `members`, a lista dos `sub` do Cognito dos moradores com conta, e usa `ownersDefinedIn('members').identityClaim('sub')`: só quem está na lista lê e grava. O AppSync não faz join entre modelos, então a lista é replicada em todos os registros. Consequências:

- Criar a casa: o criador entra em `members` da casa, do código e do primeiro `MemberRecord`; se algo falha no meio, o `HouseService` desfaz o que criou.
- Entrar por código: quem ainda não é morador não consegue ler o código nem se acrescentar. A mutation `joinHouse(code, memberName)` roda uma função (`functions/join-house`, IAM) que valida o código, acrescenta o `sub` a `members` do código, cômodos e moradores, cria o `MemberRecord` e, por último, atualiza a casa (é ela que dá o acesso). Repetir a chamada é idempotente. Código inexistente → erro `INVALID_INVITE_CODE`, traduzido pelo app em "Código de convite inválido."
- Sair da casa ou remover um morador com conta: o `HouseService.detach` reescreve `members` nos outros registros, apaga o `MemberRecord` e atualiza a casa por último. O último morador com conta que sai apaga a casa, os cômodos, os moradores e o código.
- Limitações conhecidas: um cômodo criado exatamente durante um `joinHouse` pode ficar sem o novo morador em `members`; a busca da casa do usuário (`MemberRecord.userId`) é uma listagem com filtro, limitada a 1000 itens (ok para o MVP); morador sem conta não faz login e só existe como nome.
- `amplify_outputs.json` (IDs públicos do Cognito e do AppSync, sem credenciais) é gerado pelo `ampx` no deploy; o user pool `us-east-1_M9GpISkE3` é **referenciado** (`referenceAuth`), nunca criado nem alterado pelo Amplify. Até o dono implantar este schema, o cliente com os modelos atuais não funciona contra o AppSync que já existe.

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
- **Exclusão de tarefa:** `DeleteTask` (`TaskRepository.deleteTask`, só no app/Mock: apaga a definição, as ocorrências e as atribuições, ou seja, **também o histórico**, e não confere quem pede nem o acesso ao cômodo; revisar antes de levar ao servidor)
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

No backend TypeScript o equivalente é `InMemoryStore.update(fn)` (`src/adapters/in-memory/store.ts`): `fn` é síncrona, trabalha numa cópia do estado e só a publica se termina sem erro (testes de rollback e de concorrência com `Promise.all`). O repositório DynamoDB fará o mesmo com bloqueio otimista por casa: carrega a partição, roda o comando sobre a cópia e grava a diferença num `TransactWriteItems` condicionado ao `version` da casa, repetindo se outro pedido gravou no meio (ver [BACKEND.md](BACKEND.md), seção 4).

Consultas resolvem a casa pelo cômodo e aplicam elegibilidade antes de devolver dados. Repositórios omitem as versões de escala de cômodos privados para não participantes (contêm IDs de tarefas).

Conclusão e atribuição são idempotentes: repetir não duplica esforço, responsáveis nem `FairnessDebt`. Um backend real deve prover transação ou controle otimista de versão equivalente e ser a autoridade de autorização; a UI nunca é.

## Apresentação e concorrência

- ViewModels: `@MainActor`, recebem casos de uso pelo init, controlam carregamento, conteúdo, vazio e erro.
- Views renderizam estado e encaminham ações; sem cálculo de distribuição e sem acesso a repositórios.
- Após mutações, recarregar as consultas afetadas (e também ao voltar à tela).
- `AppContainer` cria e injeta solucionador, motor, calculadores, calendário, serviços, repositórios e ViewModels. `AppSession` guarda usuário e casa atuais; o contexto é passado explicitamente aos casos de uso.
- Isolamento padrão `nonisolated` (Domain/Data não pertencem à UI). `@MainActor` explícito em ViewModels, sessão, roteador e composição. O processamento síncrono pesado roda no actor do store: sem `Task.detached`, sem actor matemático, sem `@unchecked Sendable`.

## Autenticação, perfil e WhatsApp (futuro)

- Login (e-mail/senha e Sign in with Apple pelo Hosted UI do Cognito) vive em `Data/Auth/AuthService`, sem contrato de autenticação no Domain. A UI funciona sem imagem (iniciais/avatar).
- A integração com WhatsApp vive no backend TypeScript (`src/whatsapp/`, ports em `ports.ts`); o app só vai precisar do endpoint de vínculo (`POST /me/whatsapp/link`) e de uma tela no Perfil. Proposta e estado: [BACKEND.md](BACKEND.md).

## Convenções

- Tipos e propriedades em inglês; textos de interface em português.
- Domain (pacote) importa só `Foundation`; nada de SwiftUI nem persistência. O que o app consome é `public` (structs com `init` público explícito). No TypeScript, `src/domain/` não importa `node:*` (verificado por teste).
- ViewModels não instanciam repositórios concretos; sem `Singleton.shared`.
- Regras de negócio e balanceamento não ficam em Views/ViewModels.
- Testar o Húngaro isoladamente, com matrizes de resposta conhecida.
- Mudou o algoritmo? Altere o Swift (referência) e o TypeScript, regenere as fixtures e rode as duas suítes (ver `CLAUDE.md`).
- Alterou contrato compartilhado? Atualize estes documentos.
