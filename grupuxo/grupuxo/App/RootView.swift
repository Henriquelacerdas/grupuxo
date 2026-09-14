import SwiftUI

@MainActor
struct RootView: View {
    private let container: AppContainer
    @StateObject private var session: AppSession
    @StateObject private var router = AppRouter()

    init() {
        container = AppContainer()
        _session = StateObject(wrappedValue: AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house))
    }

    init(container: AppContainer, session: AppSession) {
        self.container = container
        _session = StateObject(wrappedValue: session)
    }

    var body: some View {
        NavigationStack(path: $router.path) {
            TabView(selection: $router.selectedTab) {
                MyTasksView(viewModel: container.makeMyTasksViewModel(session: session))
                    .tabItem { Label("Tarefas", systemImage: "checklist") }
                    .tag(AppTab.myTasks)

                HouseManagementView(
                    viewModel: container.makeHouseManagementViewModel(session: session),
                    onSelectRoom: { router.navigate(to: .roomDetail($0)) },
                    onSelectSporadicTasks: { router.navigate(to: .sporadicTasks) },
                    onCreateTask: { router.navigate(to: .taskEditor(roomID: nil)) }
                )
                .tabItem { Label("Casa", systemImage: "house") }
                .tag(AppTab.house)
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Notificações", systemImage: "bell") {
                        router.navigate(to: .notifications)
                    }

                    Button("Perfil", systemImage: "person.circle") {
                        router.navigate(to: .settings)
                    }
                }
            }
            .navigationDestination(for: AppRoute.self) { route in
                destination(for: route)
            }
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case let .roomDetail(roomID):
            RoomDetailView(viewModel: container.makeRoomDetailViewModel(roomID: roomID, session: session))
        case .sporadicTasks:
            SporadicTasksView(viewModel: container.makeSporadicTasksViewModel(session: session))
        case let .taskEditor(roomID):
            TaskEditorView(viewModel: container.makeTaskEditorViewModel(roomID: roomID, session: session))
        case .notifications:
            ContentUnavailableView(
                "Histórico de notificações",
                systemImage: "bell",
                description: Text("Esta área será implementada em breve.")
            )
            .navigationTitle("Notificações")
        case .settings:
            ContentUnavailableView(
                "Configurações",
                systemImage: "person.circle",
                description: Text("Esta área será implementada em breve.")
            )
            .navigationTitle("Perfil")
        }
    }
}
