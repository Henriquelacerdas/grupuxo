# Arquitetura do app

## Visão geral

O projeto utiliza **Clean Architecture**, com **SwiftUI + MVVM**
na apresentação. Inicialmente, as camadas ficam em pastas de um
único target.

A primeira entrega utiliza dados mockados e não exige login.
A arquitetura permite substituir os mocks por integrações reais
sem alterar as Views ou as regras de domínio.

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

O fluxo de referência começa pela entrada em uma casa. O usuário cria
uma casa ou informa o código de uma casa existente. Depois de existir
uma casa ativa na sessão, o aplicativo disponibiliza as seguintes
áreas:

- Minhas tarefas: resumo semanal, tarefas periódicas atribuídas e ações
  pessoais como concluir, trocar, avaliar ou pular quando aplicável.
- Gerenciar casa: tarefas esporádicas, cômodos, rotina da casa e criação
  e manutenção de cômodos e tarefas.
- Configurações: dados da casa, perfil, férias e ações de conta.
- Notificações: histórico dos cômodos, permissões e solicitações de
  troca de tarefa.

Tarefas esporádicas são acessadas por um card dentro de Gerenciar casa.
Elas não ocupam uma aba própria na barra principal.

Criar tarefa é uma ação exclusiva de Gerenciar casa. A aba Minhas
tarefas apenas consulta tarefas destinadas ao usuário e encaminha ações
sobre ocorrências existentes. Ela não apresenta botão, menu, atalho ou
rota de criação.

O `TaskEditor` pode ser aberto pelo fluxo de criação de Gerenciar casa
ou pelo fluxo de manutenção de uma tarefa dentro de um cômodo. Quando a
criação começa sem um cômodo pré-selecionado, o editor consulta os
cômodos da casa atual e exige a escolha de um `roomID` antes de salvar.

As rotas continuam tipadas e transportam somente identificadores. A
origem das ações deve respeitar o fluxo: uma rota existente não implica
que qualquer tela tenha permissão para apresentá-la.

Na tela inicial, os atalhos de sino e perfil ficam no canto superior
direito. Eles navegam, respectivamente, para o histórico de
notificações e para as configurações do perfil; as telas podem começar
como estados de indisponibilidade até que seus fluxos sejam
implementados.

## Modelos compartilhados

Usar structs para entidades e valores, enums para estados e
políticas, e IDs estáveis para relacionamentos.

| Modelo | Representa |
| --- | --- |
| User | Identidade do usuário; e-mail continua opcional para a integração futura |
| House | Casa compartilhada, código de acesso e data de criação |
| HouseMembership | Participação do usuário na casa |
| Room | Cômodo, incluindo tipo, visibilidade e política de rotação |
| RoomMembership | Participação do usuário no cômodo |
| TaskDefinition | Configuração da tarefa, agenda e política de distribuição |
| TaskOccurrence | Uma execução específica, com estado e snapshot do esforço |
| TaskAssignment | Histórico de responsáveis, com início e término da atribuição |
| Absence | Período de férias de uma participação na casa |
| RoomAccessRequest | Pedido e estado de acesso a um cômodo privado |

Não duplicar entidades por tela.

`House` guarda `accessCode` e `createdAt`, necessários para entrar em uma
casa e exibir suas informações. A unicidade e a geração segura do código
serão responsabilidade da implementação de dados/backend.

`Room` guarda `kind`, `visibility` e `rotationPolicy`. `kind` diferencia
Casa toda de um cômodo padrão; `visibility` diferencia comum de privado;
`rotationPolicy` descreve se a responsabilidade do cômodo segue o
calendário semanal. Casa toda é um cômodo real, não um valor nulo ou uma
exceção nas tarefas.

`TaskDefinition` guarda nome, descrição, cômodo, esforço, agenda e
`assignmentPolicy`. O esforço é limitado ao intervalo de 1 a 3. A
política de atribuição diferencia distribuição automática equilibrada,
rotação por calendário, troca após conclusão e tarefa assumida pelo
próprio morador. O `houseID` não é duplicado na tarefa: ele é obtido pelo
`roomID`, evitando vínculos contraditórios.

`TaskOccurrence` guarda disponibilidade, prazo, estado, conclusão e
snapshot do esforço. `TaskAssignment` registra `assignedAt` e `endedAt`;
somente uma atribuição sem `endedAt` está ativa. Concluir ou devolver uma
tarefa encerra a atribuição em vez de apagar seu histórico.

`Absence` referencia `HouseMembership`, e não diretamente `User`, porque
férias afetam a participação da pessoa em uma casa específica. O período
deve ter início anterior ou igual ao fim.

`RoomAccessRequest` registra solicitante, cômodo, estado, criação e
resolução do pedido. As permissões para aprovar ou rejeitar permanecem
abertas e não devem ser inferidas pelo cliente.

`TaskEffort` representa somente o esforço unitário de uma tarefa e fica
entre 1 e 3. `WeeklyLoad` representa a soma semanal e, portanto, não tem
limite superior de 3; não reutilizar `TaskEffort` para carga acumulada.

Separar essas responsabilidades permite manter recorrência,
histórico e carga sem sobrescrever execuções anteriores.

Toda tarefa possui roomID, inclusive esporádicas. A apresentação
em card separado não altera esse vínculo.

Privacidade é verificada em duas etapas: acesso ao cômodo por
`RoomMembership` e visibilidade da tarefa. Cômodos privados não aparecem
na gestão comum para quem não participa; pedidos de entrada usam
`RoomAccessRequest`.

## Casos de uso e regras

ViewModels acessam o domínio por casos de uso, sem chamar
repositórios diretamente.

Casos de uso iniciais:

- GetMyTasksUseCase
- GetHouseRoomsUseCase
- GetRoomTasksUseCase
- GetSporadicTasksUseCase
- CreateTaskUseCase
- CompleteTaskUseCase
- ClaimSporadicTaskUseCase
- ReleaseSporadicTaskUseCase

Casos de uso coordenam operações. Regras reutilizáveis ficam em
serviços como WeeklyLoadCalculator, TaskDistributionEngine,
RotationCalculator e TaskEligibilityPolicy.

`TaskDistributionEngine` recebe tarefas disponíveis, elegíveis por
cômodo, carga semanal, ausências e último responsável. A primeira etapa
é gulosa, priorizando menor carga e usando repetição recente como
desempate. A busca local deve operar sobre o resultado dessa etapa para
reduzir a maior diferença de carga sem violar elegibilidade; sua
estratégia final ainda deve ser coberta por testes antes de substituir
o comportamento inicial.

Calculadores recebem dados e data de referência e devolvem
resultados. Não acessam interface, banco ou sessão global.

Filtros e autorização devem ser centralizados: tarefas privadas
não podem vazar em consultas, e esporádicas não aparecem na
listagem interna dos cômodos.

Não criar protocolos para todo caso de uso sem necessidade.
Priorizar protocolos nas fronteiras, como repositórios.

## Repositórios e dados

Os protocolos HouseRepository, RoomRepository e TaskRepository
ficam em Domain. As implementações ficam em Data.

Operações potencialmente externas usam async throws desde os mocks.
Métodos representam ações de negócio, como concluir, assumir e
devolver, em vez de expor apenas save/delete genéricos.

Todos os repositórios mockados compartilham um único MockStore,
preferencialmente um actor. MockSeed centraliza os dados iniciais.

O `MockStore` preserva moradores, casas, participações, cômodos,
participações em cômodos, definições, ocorrências, histórico de
atribuições, férias e pedidos de acesso. Consultas de tarefas resolvem a
casa pelo cômodo e aplicam a elegibilidade antes de devolver dados.

Conclusão e atribuição devem ser consistentes e idempotentes:
repetir uma operação não duplica esforço, responsáveis ou efeitos.
Assumir uma tarefa cria uma atribuição ativa; devolver ou concluir define
seu término. Registros históricos não são removidos.

No backend futuro, autorização e atomicidade também devem ser
garantidas pelo servidor. A interface não é a autoridade final
sobre os dados compartilhados.

DTOs pertencem a Data e são convertidos para entidades de Domain.

## Apresentação e dependências

ViewModels são @MainActor e recebem casos de uso pelo inicializador.
Controlam carregamento, conteúdo, estado vazio e erros.

Views renderizam estado e encaminham ações. Não calculam
distribuição nem acessam repositórios.

`MyTasksView` não conhece `CreateTaskUseCase` e não recebe callback de
criação. `HouseManagementView` é a origem da criação e encaminha a ação
ao roteador. `TaskEditorViewModel` carrega os cômodos por
`GetHouseRoomsUseCase`, sem acessar mocks ou repositórios concretos.

Formulários mantêm rascunhos locais até salvar. Navegação usa
rotas tipadas com IDs, evitando cópias desatualizadas de entidades.

Após alterações, recarregar consultas afetadas; atualizar também
ao retornar à tela na implementação inicial.

AppContainer cria e injeta repositórios, serviços e ViewModels.
AppSession mantém usuário e casa atuais, simulados inicialmente.
O contexto necessário é passado explicitamente aos casos de uso.

Não usar Singleton.shared para acessar dependências.

## Autenticação e perfil

A integração futura com Sign in with Apple fica em Data, atrás
de um contrato de autenticação definido em Domain.

Não haverá seleção ou edição de foto de perfil. Sign in with Apple
não disponibiliza a foto do Apple ID; a interface deve funcionar
sem imagem. Avatar padrão ou iniciais são o fallback recomendado,
sem tornar photoURL obrigatório no modelo.

## Convenções para equipe e IAs

- Tipos e propriedades em inglês; textos da interface em português.
- Domain não importa SwiftUI nem frameworks de persistência.
- ViewModels não instanciam repositórios concretos.
- Regras de negócio não ficam em Views ou ViewModels.
- Não criar versões próprias de entidades em cada funcionalidade.
- Não introduzir frameworks, módulos ou abstrações sem necessidade.
- Testar regras de domínio e contratos relevantes com dados controlados.
- Alterações em contratos compartilhados devem atualizar este guia.
- Regras de produto ainda abertas não devem ser inventadas no código.

Primeiro fluxo a implementar:
Gerenciar casa → criar/visualizar cômodo → criar tarefa → atribuir →
concluir em Minhas tarefas → atualizar as consultas afetadas.
