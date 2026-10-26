import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {

    @StateObject private var model: RootModel

    @State private var selectedTab: AppTab = .myTasks

    @State private var tasksPath: [AppRoute] = []

    @State private var housePath: [AppRoute] = []

    /// A tarefa aberta na sheet de detalhes; qualquer aba pode abri-la.
    @State private var presentedTask: PresentedTask?

    /// Sobe quando a sheet fecha, para as listas por trás recarregarem o que ela pode ter mudado.
    @State private var taskChanges = 0

    init(api: APIClient, user: User, house: House) {
        _model = StateObject(wrappedValue: RootModel(api: api, user: user, house: house))
    }

    private var container: AppContainer { model.container }

    private var session: AppSession { model.session }

    var body: some View {
        tabs
            .toastHost()
    }

    private var tabs: some View {

        TabView(selection: $selectedTab) {

            NavigationStack(path: $tasksPath) {

                MyTasksView(
                    viewModel:
                        container.makeMyTasksViewModel(
                            session: session
                        ),
                    makeTaskEditorViewModel: {

                        container.makeTaskEditorViewModel(
                            roomID: nil,
                            session: session
                        )

                    },
                    onRequestSwap: { occurrenceID in
                        tasksPath.append(.taskSwap(offeredOccurrenceID: occurrenceID))
                    },
                    onSelectTask: { taskDefinitionID in
                        presentedTask = PresentedTask(id: taskDefinitionID)
                    },
                    onSelectNotifications: {
                        tasksPath.append(.notifications)
                    },
                    onSelectProfile: {
                        tasksPath.append(.settings)
                    },
                    reloadTrigger: ReloadKey(tab: selectedTab, taskChanges: taskChanges)
                )
                .navigationDestination(
                    for: AppRoute.self
                ) { route in

                    destination(
                        for: route
                    )

                }

            }
            .tabItem {

                Label(
                    "Tarefas",
                    systemImage: "checkmark.circle"
                )

            }
            .tag(
                AppTab.myTasks
            )

            NavigationStack(path: $housePath) {

                HouseManagementView(
                    viewModel:
                        container.makeHouseManagementViewModel(
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
                            .roomDetail(
                                roomID
                            )
                        )

                    },
                    onSelectSporadicTasks: {
                        housePath.append(.sporadicTasks)
                    }
                )
                .navigationDestination(
                    for: AppRoute.self
                ) { route in

                    destination(
                        for: route
                    )

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
                viewModel:
                    container.makeTaskDetailViewModel(
                        taskDefinitionID: task.id,
                        session: session
                    ),
                // Sem `PATCH` na `api`: a tela só mostra os detalhes.
                allowsEditing: false
            )

        }

    }

    @ViewBuilder
    private func destination(
        for route: AppRoute
    ) -> some View {

        switch route {

        case let .roomDetail(roomID):

            RoomDetailView(
                viewModel:
                    container.makeRoomDetailViewModel(
                        roomID: roomID,
                        session: session
                    ),
                makeSuggestionEditorViewModel: { suggestion in

                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        suggestion: suggestion,
                        session: session
                    )

                },
                makeTaskEditorViewModel: {

                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        session: session
                    )

                },
                onSelectTask: { taskDefinitionID in

                    presentedTask = PresentedTask(id: taskDefinitionID)

                },
                reloadTrigger: taskChanges
            )

        case .sporadicTasks:

            SporadicTasksView(
                viewModel:
                    container.makeSporadicTasksViewModel(
                        session: session
                    ),
                onEditTask: {
                    taskDefinitionID in

                    presentedTask = PresentedTask(id: taskDefinitionID)
                },
                reloadTrigger: taskChanges
            )

        case let .taskEditor(roomID):

            TaskEditorView(
                viewModel:
                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        session: session
                    )
            )

        case let .taskSwap(offeredOccurrenceID):

            TaskSwapView(
                viewModel:
                    container.makeTaskSwapViewModel(
                        offeredOccurrenceID:
                            offeredOccurrenceID,
                        session: session
                    )
            )

        case .notifications:

            NotificationsView(
                viewModel:
                    container.makeNotificationsViewModel(
                        session: session
                    )
            )

        case .settings:
            HouseView(whatsAppViewModel: container.makeWhatsAppConnectionViewModel())
        }

    }

}

/// Tarefa aberta na sheet de detalhes (`TaskDefinition.ID` sozinho não é `Identifiable`).
private struct PresentedTask: Identifiable {
    let id: TaskDefinition.ID
}

private struct ReloadKey: Hashable {
    let tab: AppTab
    let taskChanges: Int
}
