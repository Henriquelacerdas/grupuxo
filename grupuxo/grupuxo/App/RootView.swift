import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {

    @EnvironmentObject private var houses: HouseService

    @StateObject private var model = RootModel()

    @State private var selectedTab: AppTab = .myTasks

    @State private var tasksPath: [AppRoute] = []

    @State private var housePath: [AppRoute] = []

    private var container: AppContainer { model.container }

    private var session: AppSession { model.session }

    /// Muda sempre que moradores ou cômodos da casa real mudam.
    private var syncKey: [String] {
        [houses.house?.id ?? "", houses.inviteCode ?? ""]
            + houses.rooms.map { "r:\($0.id):\($0.name)" }
            + houses.members.map { "m:\($0.id):\($0.userId ?? "-"):\($0.name)" }
    }

    var body: some View {
        Group {
            if model.isSynced {
                tabs
            } else {
                ProgressView("Carregando sua casa…")
            }
        }
        .task(id: syncKey) {
            await syncWithHouse()
        }
    }

    private func syncWithHouse() async {
        guard let house = houses.house, let me = houses.myMember else { return }

        let houseID = Self.uuid(house.id)
        let snapshot = HouseSnapshot(
            houseID: houseID,
            houseName: house.name,
            inviteCode: houses.inviteCode ?? "",
            residents: houses.members.map {
                .init(id: Self.uuid($0.userId ?? $0.id), name: $0.name)
            },
            rooms: houses.rooms.map {
                .init(id: Self.uuid($0.id), name: $0.name)
            }
        )

        do {
            try await model.apply(
                snapshot,
                user: User(id: Self.uuid(me.userId ?? me.id), name: me.name, email: nil),
                house: House(
                    id: houseID, name: house.name, accessCode: houses.inviteCode ?? "", createdAt: .now
                )
            )
        } catch {
            return
        }
    }

    private static func uuid(_ string: String) -> UUID {
        UUID(uuidString: string) ?? UUID()
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
                            session: session,
                            onCreated: { room in
                                await houses.addRoom(
                                    name: room.name,
                                    id: room.id.uuidString
                                )
                            }
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
            HouseGateView {
                HouseView(
                    whatsApp:
                        container.makeWhatsAppConnectionViewModel()
                )
            }
        }

    }

}
