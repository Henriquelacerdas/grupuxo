import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {

    @EnvironmentObject private var houses: HouseService

    @EnvironmentObject private var authService: AuthService

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
            switch model.syncState {
            case .synced:
                tabs
            case .syncing:
                ProgressView("Carregando sua casa…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Não foi possível abrir a casa", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Tentar novamente") { Task { await syncWithHouse() } }
                        .buttonStyle(.borderedProminent)
                    Button("Sair da conta", role: .destructive) { Task { await authService.signOut() } }
                }
            }
        }
        .task(id: syncKey) {
            await syncWithHouse()
        }
    }

    private func syncWithHouse() async {
        guard let house = houses.house, let me = houses.myMember else { return }
        await model.sync(
            house: house, members: houses.members, rooms: houses.rooms,
            inviteCode: houses.inviteCode, me: me
        )
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
                                do {
                                    try await houses.addRoomOrThrow(
                                        name: room.name,
                                        id: room.id.uuidString
                                    )
                                } catch {
                                    // O Mock já criou o cômodo: re-sincroniza com a casa real para
                                    // removê-lo e deixa o erro aparecer no formulário.
                                    await syncWithHouse()
                                    throw error
                                }
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
