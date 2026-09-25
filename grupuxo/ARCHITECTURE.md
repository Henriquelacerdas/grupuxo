# Arquitetura do app

## Visão geral

O projeto utiliza **Clean Architecture**, com **SwiftUI + MVVM** na apresentação. Inicialmente, as camadas ficam em pastas de um único target.

A primeira entrega utiliza dados mockados e não exige login. A arquitetura permite substituir os mocks por integrações reais sem alterar as Views ou as regras de domínio. O processamento algorítmico pesado (como a delegação de tarefas) rodará nativamente on-device, otimizado para performance em mobile.

## Camadas

| Camada | Responsabilidade |
| --- | --- |
| Domain | Entidades, regras de negócio, casos de uso e contratos de repositórios |
| Presentation | Views, ViewModels, navegação e estados de interface |
| Data | Implementações dos repositórios, mocks e futuras integrações |
| App | Inicialização, sessão e composição das dependências |

Dependências de código:

- Presentation depende de Domain.
- Data depende de Domain.
- Domain não depende das outras camadas.
- App conhece as implementações para montar as dependências.

Fluxo de uma ação:

View → ViewModel → UseCase → Repository → implementação em Data.

## Estrutura

    App/
      DomesticApp.swift
      AppContainer.swift
      AppSession.swift
      RootView.swift

    Domain/
      Entities/
      ValueObjects/
      Repositories/
      UseCases/
      Services/
        TaskDistributionEngine.swift
        FairnessCalculator.swift
        HungarianAlgorithm.swift
        RotationCalculator.swift
        TaskSchedulingService.swift
      Errors/

    Presentation/
      Features/
        MyTasks/
        HouseManagement/
        RoomDetail/
        TaskEditor/
        SporadicTasks/
      Navigation/
      DesignSystem/

    Data/
      Mock/
        MockStore.swift
        MockSeed.swift
        MockHouseRepository.swift
        MockRoomRepository.swift
        MockTaskRepository.swift

    Tests/
      DomainTests/
      DataTests/
      PresentationTests/

Cada funcionalidade contém sua View, ViewModel e estados locais.
Criar Data/Remote, DTOs e mappers quando houver integração real.

## Fluxo de produto e navegação

O fluxo de referência começa pela entrada em uma casa. O usuário cria uma casa ou informa o código de uma casa existente. Depois de existir uma casa ativa na sessão, o aplicativo disponibiliza as seguintes áreas:

- Minhas tarefas: resumo semanal, tarefas periódicas atribuídas e ações pessoais como concluir, trocar, avaliar ou pular quando aplicável.
- Gerenciar casa: tarefas esporádicas, cômodos, rotina da casa e criação e manutenção de cômodos e tarefas.
- Configurações: dados da casa, perfil, férias e ações de conta.
- Notificações: histórico dos cômodos, permissões e solicitações de troca de tarefa.

Tarefas esporádicas são acessadas por um card dentro de Gerenciar casa. Elas não ocupam uma aba própria na barra principal.

Criar tarefa é uma ação exclusiva de Gerenciar casa. A aba Minhas tarefas apenas consulta tarefas destinadas ao usuário e encaminha ações sobre ocorrências existentes. Ela não apresenta botão, menu, atalho ou rota de criação.

O `TaskEditor` pode ser aberto pelo fluxo de criação de Gerenciar casa ou pelo fluxo de manutenção de uma tarefa dentro de um cômodo. Quando a criação começa sem um cômodo pré-selecionado, o editor consulta os cômodos da casa atual e exige a escolha de um `roomID` antes de salvar.

As rotas continuam tipadas e transportam somente identificadores. A origem das ações deve respeitar o fluxo: uma rota existente não implica que qualquer tela tenha permissão para apresentá-la.

Na tela inicial, os atalhos de sino e perfil ficam no canto superior direito. Eles navegam, respectivamente, para o histórico de notificações e para as configurações do perfil; as telas podem começar como estados de indisponibilidade até que seus fluxos sejam implementados.

## Modelos compartilhados

Usar structs para entidades e valores, enums para estados e políticas, e IDs estáveis para relacionamentos.

| Modelo | Representa |
| --- | --- |
| User | Identidade do usuário; e-mail opcional para a integração futura |
| House | Casa compartilhada, código de acesso e data de criação |
| HouseMembership | Participação do usuário na casa |
| Room | Cômodo, visibilidade, periodicidade semanal, quantidade de responsáveis e versões da escala |
| RoomMembership | Participação do usuário no cômodo (armazena também o `FairnessDebt`) |
| TaskDefinition | Configuração central da tarefa (molde rotativo, esforço, agenda) |
| TaskOccurrence | Instância de execução histórica ou pendente (imutável quanto ao passado) |
| TaskAssignment | Histórico de responsáveis, com início e término da atribuição |
| Absence | Período de férias de uma participação na casa |

Não duplicar entidades por tela. Existe uma distinção técnica obrigatória: `TaskDefinition` e `TaskOccurrence`.

`TaskDefinition` guarda nome, cômodo, esforço, agenda e a fila rotativa. O `houseID` não é duplicado: é obtido pelo `roomID`.
`TaskOccurrence` guarda uma execução específica (estado, snapshot do esforço na época, responsável atual). A alteração de uma `TaskDefinition` no presente não reescreve os registros de `TaskOccurrence` passados.

`RoomMembership` mantém acesso atual (`leftAt`), histórico de participação na rotação (`rotationChanges`) e o `FairnessDebt` (Saldo de Justiça) do morador naquele cômodo. Quando o morador conclui uma ocorrência de esforço E, seu saldo aumenta em `E - (E/M)` e o saldo dos demais elegíveis daquele cômodo desce `E/M`.

Toda tarefa possui roomID, inclusive esporádicas. A apresentação em card separado não altera esse vínculo.

## Casos de uso e regras

ViewModels acessam o domínio por casos de uso, sem chamar repositórios diretamente.

Casos de uso iniciais:

- GetMyTasksUseCase
- GetHouseRoomsUseCase
- GetRoomTasksUseCase
- GetSporadicTasksUseCase
- CreateTaskUseCase
- CompleteTaskUseCase
- ClaimSporadicTaskUseCase
- ReleaseSporadicTaskUseCase

Casos de uso coordenam operações. Regras matemáticas reutilizáveis ficam em serviços dedicados como `TaskDistributionEngine` e `FairnessCalculator`.

`TaskDistributionEngine` otimiza o custo por usuário e semana, com horizonte de 12 semanas.
Para criar uma **nova fila rotativa**, ele cria uma matriz bidimensional simulando as próximas 12 semanas. Avalia-se o custo quadrático de colocar cada membro em cada "slot" da fila e utiliza-se o **Algoritmo Húngaro** para extrair a permutação ótima em $O(N^3)$.
Para **entrada e saída de participantes**, `HouseQueueOptimizer` reotimiza as filas da casa a partir da próxima segunda-feira, incluindo ocorrências futuras já publicadas. Executa Húngaro lexicográfico por fila, com duas configurações iniciais e até 20 passagens de melhoria por configuração. Prioriza esforço semanal, concentração de dificuldades, saldo e estabilidade. Preserva a semana atual, atrasados e concluídos; o ótimo de cada matriz não implica ótimo global da casa.

O contrato detalhado de calendário, amortização do saldo, elegibilidade e limitações está em `ALGORITHM.md`. `TaskAssignment.supersededAt` preserva o histórico dos planos futuros substituídos. `TaskDefinition.pendingRotation` controla a vigência de filas por conclusão. Vínculos são mantidos na saída para conservar o saldo; consultas filtram acesso atual e liberam somente as pendências atribuídas ao ex-participante. Ausências podem deixar posições sem responsável; a última saída exclui cômodo e tarefas mediante confirmação. Casa toda não permite essa saída. O cursor avança ao publicar uma ocorrência, nunca ao concluir uma ocorrência de calendário. Tarefas sem calendário publicam somente uma sucessora por conclusão.

`TaskSchedulingService` concentra as transições de criação, conclusão, extensão de horizonte, entrada e saída de participantes. Recebe o snapshot `TaskSchedulingState`, sem depender de Data. `CreateTaskUseCase`, `CompleteTaskUseCase`, `RefreshTaskScheduleUseCase`, `AddRoomMemberUseCase` e `RemoveRoomMemberUseCase` são fachadas assíncronas dos comandos transacionais; não fazem leituras independentes antes da gravação.

Calculadores recebem arrays primitivos (para otimizar a memória L1 do device) e data de referência, devolvendo resultados determinísticos. Não acessam interface, banco ou sessão global.

## Repositórios e dados

Os protocolos HouseRepository, RoomRepository e TaskRepository ficam em Domain. As implementações ficam em Data.

Operações potencialmente externas usam async throws desde os mocks. Métodos representam ações de negócio, como concluir, assumir e devolver, em vez de expor apenas save/delete genéricos.

Todos os repositórios mockados compartilham um único `MockStore`, que é um actor. `MockSeed` gera os dados de demonstração usando o mesmo planejador dos comandos reais. Não há migração de persistência remota.

`TaskRepository.create(_:requestedBy:at:)`, `complete`, `refreshSchedule`, `addMember` e `removeMember` executam transições de domínio sobre o mesmo snapshot que será persistido. `MockStore.update` usa cópia e commit após sucesso, com rollback em qualquer erro. O serviço é síncrono dentro da closure do actor, sem suspensão entre validação e commit. Isso evita uma corrida entre ler participantes/carga, calcular o Húngaro e salvar a fila. Uma futura implementação remota deve fornecer transação ou controle otimista de versão equivalente.

A alocação do cálculo dentro da transação é uma decisão da implementação Data, não uma transferência da matemática para Data. O serviço continua isolado e testável em Domain. As projeções usam esforço snapshot de ocorrências pendentes atribuídas em todos os cômodos da casa; saldos continuam locais ao cômodo.

O `MockStore` preserva o ecossistema. Consultas de tarefas resolvem a casa pelo cômodo e aplicam a elegibilidade antes de devolver dados.

Conclusão e atribuição devem ser consistentes e idempotentes: repetir uma operação não duplica esforço, responsáveis, nem corrompe o cálculo de `FairnessDebt`.

No backend futuro, autorização e atomicidade também devem ser garantidas pelo servidor. A interface não é a autoridade final sobre os dados compartilhados.

## Apresentação e dependências

ViewModels são @MainActor e recebem casos de uso pelo inicializador. Controlam carregamento, conteúdo, estado vazio e erros.

Views renderizam estado e encaminham ações. Não calculam distribuição, projeção de 12 semanas, nem acessam repositórios.

Após alterações, recarregar consultas afetadas; atualizar também ao retornar à tela na implementação inicial.

AppContainer cria e injeta o solucionador Húngaro, motor de distribuição, calculador de justiça, rotação, calendário, serviço de agendamento, repositórios e ViewModels. AppSession mantém usuário e casa atuais. O contexto necessário é passado explicitamente aos casos de uso.

Não usar Singleton.shared para acessar dependências.

Os targets compilam em Swift 6 com concorrência estrita completa. O isolamento padrão é `nonisolated`, pois Domain/Data não pertencem à interface. Views seguem o isolamento do SwiftUI; ViewModels, sessão, roteador e composição usam `@MainActor` explicitamente. O processamento síncrono pesado acontece no actor do store e não precisa de `Task.detached`, outro actor matemático ou tipos `@unchecked Sendable`.

Testes executáveis ficam em `grupuxoTests`, fora do target do aplicativo. Os arquivos em `grupuxo/Tests` são guias históricos, não a suíte executada.

## Autenticação e perfil

A integração futura com Sign in with Apple fica em Data, atrás de um contrato de autenticação definido em Domain.
A interface deve funcionar sem imagem. Avatar padrão ou iniciais são o fallback recomendado.

## Convenções para equipe e IAs

- Tipos e propriedades em inglês; textos da interface em português.
- Domain não importa SwiftUI nem frameworks de persistência.
- ViewModels não instanciam repositórios concretos.
- Regras de negócio, projeção de carga e balanceamento matemático não ficam em Views ou ViewModels.
- Alterar uma definição não modifica seu histórico. A exceção destrutiva é excluir cômodo e tarefas mediante confirmação da última saída.
- Testar regras matemáticas do Algoritmo Húngaro isoladamente no target de testes com matrizes conhecidas.
- Alterações em contratos compartilhados devem atualizar este guia.

Primeiro fluxo a implementar:
Gerenciar casa → criar/visualizar cômodo → criar tarefa → calcular Húngaro → gerar ocorrências → concluir em Minhas tarefas → atualizar as consultas afetadas.

## Participação e escala de cômodos

`RoomScheduling` estende o serviço de domínio com calendários em semanas, blocos gulosos e versões da escala. `WeeklyPeriodicity` representa n execuções em x semanas. `RoomScheduleVersion` preserva fila, posições das tarefas e vigência. Tarefas de periodicidade idêntica usam a escala do cômodo; as demais continuam independentes. `HouseQueueOptimizer` recebe contribuições agregadas por slot, sem romper a restrição de responsáveis.

`GetRoomParticipationUseCase` expõe dados de apresentação, responsáveis atuais e período. `GetHouseRoomsUseCase` lista todos os cômodos ou apenas os participantes para o editor. Repositórios omitem versões da escala de cômodos privados para não participantes e aplicam autorização às consultas e ações de tarefas. Não há privacidade individual de tarefas nem pedidos de entrada.

`CreateRoomUseCase` recebe periodicidade e quantidade de responsáveis. A criação valida a composição completa dos comuns. `AddRoomMemberUseCase` permite entrada livre; `RemoveRoomMemberUseCase` recebe confirmação explícita para a última saída. A exclusão em cascata inclui vínculos e histórico. A interface usa alerta nativo com Cancelar e Sair e excluir.

`AddHouseMemberUseCase` inclui novos moradores em todos os comuns. `RemoveHouseMemberUseCase` remove todos os vínculos atuais e exige confirmação caso privados sejam esvaziados. Repositórios executam essas alterações e um único replanejamento em uma transação. Casa toda permanece comum e sem saída individual.
