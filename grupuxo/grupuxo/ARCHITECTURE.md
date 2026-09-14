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

## Modelos compartilhados

Usar structs para entidades e valores, enums para estados e
políticas, e IDs estáveis para relacionamentos.

| Modelo | Representa |
| --- | --- |
| User | Identidade do usuário |
| House | Casa compartilhada |
| HouseMembership | Participação do usuário na casa |
| Room | Cômodo, incluindo Casa toda |
| RoomMembership | Participação do usuário no cômodo |
| TaskDefinition | Configuração da tarefa |
| TaskOccurrence | Uma execução específica da tarefa |
| TaskAssignment | Responsável por uma ocorrência e período da atribuição |
| Absence | Período de férias |

Não duplicar entidades por tela.

TaskDefinition guarda nome, descrição, cômodo, esforço e políticas.
TaskOccurrence guarda disponibilidade, prazo, conclusão e snapshot
do esforço. TaskAssignment registra a atribuição.

Separar essas responsabilidades permite manter recorrência,
histórico e carga sem sobrescrever execuções anteriores.

Toda tarefa possui roomID, inclusive esporádicas. A apresentação
em card separado não altera esse vínculo.

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

Conclusão e atribuição devem ser consistentes e idempotentes:
repetir uma operação não duplica esforço, responsáveis ou efeitos.

No backend futuro, autorização e atomicidade também devem ser
garantidas pelo servidor. A interface não é a autoridade final
sobre os dados compartilhados.

DTOs pertencem a Data e são convertidos para entidades de Domain.

## Apresentação e dependências

ViewModels são @MainActor e recebem casos de uso pelo inicializador.
Controlam carregamento, conteúdo, estado vazio e erros.

Views renderizam estado e encaminham ações. Não calculam
distribuição nem acessam repositórios.

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
gestão da casa → cômodo → tarefa → concluir → atualizar Minhas tarefas.
