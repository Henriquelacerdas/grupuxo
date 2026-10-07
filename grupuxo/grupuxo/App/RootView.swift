import SwiftUI

@MainActor
struct RootView: View {

    private let container: AppContainer

    @StateObject private var session: AppSession

    @State private var selectedTab: AppTab = .myTasks

    @State private var tasksPath: [AppRoute] = []

    @State private var housePath: [AppRoute] = []

    init() {

        container = AppContainer()

        _session = StateObject(
            wrappedValue: AppSession(
                currentUser: MockSeed.currentUser,
                currentHouse: MockSeed.house
            )
        )

    }

    init(
        container: AppContainer,
        session: AppSession
    ) {

        self.container = container

        _session = StateObject(
            wrappedValue: session
        )

    }

    var body: some View {

        TabView(selection: $selectedTab) {

            NavigationStack(path: $tasksPath) {

                MyTasksView(
                    viewModel:
                        container.makeMyTasksViewModel(
                            session: session
                        ),
                    onRequestSwap: { occurrenceID in

                        tasksPath.append(
                            .taskSwap(
                                offeredOccurrenceID: occurrenceID
                            )
                        )

                    },
                    onSelectNotifications: {

                        tasksPath.append(
                            .notifications
                        )

                    },
                    onSelectProfile: {

                        tasksPath.append(
                            .settings
                        )

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

                        housePath.append(
                            .sporadicTasks
                        )

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
            .tag(
                AppTab.house
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
                    )
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

            ProfileView(
                viewModel:
                    container.makeProfileViewModel(
                        session: session
                    )
            )

        }

    }

}
