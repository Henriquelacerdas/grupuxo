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
        _session = StateObject(wrappedValue: AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house))
    }

    init(container: AppContainer, session: AppSession) {
        self.container = container
        _session = StateObject(wrappedValue: session)
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            // Cada aba possui sua própria barra e histórico de navegação.
            NavigationStack(path: $tasksPath) {
                MyTasksView(
                    viewModel: container.makeMyTasksViewModel(session: session),
                    onSelectNotifications: { tasksPath.append(.notifications) },
                    onSelectProfile: { tasksPath.append(.settings) }
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem { Label("Tarefas", systemImage: "checklist") }
            .tag(AppTab.myTasks)

            NavigationStack(path: $housePath) {
                HouseManagementView(
                    viewModel: container.makeHouseManagementViewModel(session: session),
                    onSelectRoom: { housePath.append(.roomDetail($0)) },
                    onSelectSporadicTasks: { housePath.append(.sporadicTasks) }
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem { Label("Casa", systemImage: "house") }
            .tag(AppTab.house)
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
