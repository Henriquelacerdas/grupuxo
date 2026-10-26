
import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {

    @StateObject private var model: RootModel

    @State private var selectedTab: AppTab = .myTasks

    @State private var tasksPath: [AppRoute] = []

    @State private var housePath: [AppRoute] = []

    /// Tarefa aberta na sheet de detalhes.
    @State private var presentedTask: PresentedTask?

    /// Atualiza as listas quando a sheet de detalhes é fechada.
    @State private var taskChanges = 0

    init(api: APIClient, user: User, house: House) {
        _model = StateObject(
            wrappedValue: RootModel(
                api: api,
                user: user,
                house: house
            )
        )
    }

    private var container: AppContainer {
        model.container
    }

    private var session: AppSession {
        model.session
    }

    var body: some View {
        tabs
            .toastHost()
    }

    private var tabs: some View {

        TabView(selection: $selectedTab) {

            // MARK: - Minhas tarefas

            NavigationStack(path: $tasksPath) {

                MyTasksView(
                    viewModel: container.makeMyTasksViewModel(
                        session: session
                    ),

                    makeTaskEditorViewModel: {
                        container.makeTaskEditorViewModel(
                            roomID: nil,
                            session: session
                        )
                    },

                    onRequestSwap: { occurrenceID in
                        tasksPath.append(
                            .taskSwap(
                                offeredOccurrenceID: occurrenceID
                            )
                        )
                    },

                    onSelectTask: { taskDefinitionID in
                        presentedTask = PresentedTask(
                            id: taskDefinitionID
                        )
                    },

                    onSelectNotifications: {
                        tasksPath.append(.notifications)
                    },

                    onSelectProfile: {
                        tasksPath.append(.settings)
                    },

                    reloadTrigger: ReloadKey(
                        tab: selectedTab,
                        taskChanges: taskChanges
                    )
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem {
                Label(
                    "Tarefas",
                    systemImage: "checkmark.circle"
                )
            }
            .tag(AppTab.myTasks)

            // MARK: - Gerenciamento da casa

            NavigationStack(path: $housePath) {

                HouseManagementView(
                    viewModel: container.makeHouseManagementViewModel(
                        session: session
                    ),

                    houseName: session.currentHouse.name,

                    makeTaskEditorViewModel: {
                        container.makeTaskEditorViewModel(
                            roomID: nil,
                            session: session
                        )
                    },

                    makeRoomEditorViewModel: {
                        container.makeRoomEditorViewModel(
                            session: session
                        )
                    },

                    onSelectRoom: { roomID in
                        housePath.append(
                            .roomDetail(roomID)
                        )
                    },

                    onSelectSporadicTasks: {
                        housePath.append(.sporadicTasks)
                    }
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem {
                Label(
                    "Casa",
                    systemImage: "house"
                )
            }
            .tag(AppTab.house)
        }
        .sheet(
            item: $presentedTask,
            onDismiss: {
                taskChanges += 1
            }
        ) { task in

            TaskDetailView(
                viewModel: container.makeTaskDetailViewModel(
                    taskDefinitionID: task.id,
                    session: session
                ),

                // A API ainda não disponibiliza PATCH para edição.
                allowsEditing: false
            )
        }
    }

    // MARK: - Destinations

    @ViewBuilder
    private func destination(
        for route: AppRoute
    ) -> some View {

        switch route {

        // MARK: Room Detail

       
        case let .roomDetail(roomID):

            RoomDetailView(
                viewModel: container.makeRoomDetailViewModel(
                    roomID: roomID,
                    session: session
                ),

                makeTaskEditorViewModel: {
                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        session: session
                    )
                },

                makeSuggestionEditorViewModel: { suggestion in
                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        suggestion: suggestion,
                        session: session
                    )
                },

                onSelectTask: { taskDefinitionID in
                    presentedTask = PresentedTask(
                        id: taskDefinitionID
                    )
                }
            )


        // MARK: Sporadic Tasks

        case .sporadicTasks:

            SporadicTasksView(
                viewModel: container.makeSporadicTasksViewModel(
                    session: session
                ),

                onEditTask: { taskDefinitionID in
                    presentedTask = PresentedTask(
                        id: taskDefinitionID
                    )
                },

                reloadTrigger: taskChanges
            )

        // MARK: Task Editor

        case let .taskEditor(roomID):

            TaskEditorView(
                viewModel: container.makeTaskEditorViewModel(
                    roomID: roomID,
                    session: session
                )
            )

        // MARK: Task Swap

        case let .taskSwap(offeredOccurrenceID):

            TaskSwapView(
                viewModel: container.makeTaskSwapViewModel(
                    offeredOccurrenceID: offeredOccurrenceID,
                    session: session
                )
            )

        // MARK: Notifications

        case .notifications:

            NotificationsView(
                viewModel: container.makeNotificationsViewModel(
                    session: session
                )
            )

        // MARK: Settings

        case .settings:

            HouseView(
                whatsAppViewModel:
                    container.makeWhatsAppConnectionViewModel()
            )
        }
    }
}

// MARK: - Presented Task

/// Permite abrir detalhes de uma tarefa em uma sheet.
private struct PresentedTask: Identifiable {
    let id: TaskDefinition.ID
}

// MARK: - Reload Key

/// Identifica mudanças que exigem recarregar a lista de tarefas.
private struct ReloadKey: Hashable {
    let tab: AppTab
    let taskChanges: Int
}
