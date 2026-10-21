import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {

    @StateObject private var model: RootModel

    @State private var selectedTab: AppTab = .myTasks

    @State private var tasksPath: [AppRoute] = []

    @State private var housePath: [AppRoute] = []

    init(api: APIClient, user: User, house: House) {
        _model = StateObject(wrappedValue: RootModel(api: api, user: user, house: house))
    }

    private var container: AppContainer { model.container }

    private var session: AppSession { model.session }

    var body: some View {
        tabs
    }

    private var tabs: some View {

        TabView(selection: $selectedTab) {

            NavigationStack(path: $tasksPath) {

                MyTasksView(
                    viewModel:
                        container.makeMyTasksViewModel(
                            session: session
                        ),
                    onRequestSwap: { occurrenceID in
                        tasksPath.append(.taskSwap(offeredOccurrenceID: occurrenceID))
                    },
                    onSelectNotifications: {
                        tasksPath.append(.notifications)
                    },
                    onSelectProfile: {
                        tasksPath.append(.settings)
                    },
                    reloadTrigger: selectedTab
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
                    systemImage: "checklist"
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
                onSelectTask: { taskDefinitionID in

                    housePath.append(
                        .taskDetail(
                            taskDefinitionID
                        )
                    )

                }
            )

        case let .taskDetail(taskDefinitionID):

            TaskDetailView(
                viewModel:
                    container.makeTaskDetailViewModel(
                        taskDefinitionID:
                            taskDefinitionID,
                        session: session
                    ),
                // Sem `PATCH` na `api`: a tela só mostra os detalhes.
                allowsEditing: false
            )

        case .sporadicTasks:

            SporadicTasksView(
                viewModel:
                    container.makeSporadicTasksViewModel(
                        session: session
                    ),
                onEditTask: {
                    taskDefinitionID in

                    housePath.append(
                        .taskDetail(
                            taskDefinitionID
                        )
                    )
                }
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
