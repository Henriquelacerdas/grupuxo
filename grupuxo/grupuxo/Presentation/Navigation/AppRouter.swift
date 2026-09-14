import Combine

@MainActor
final class AppRouter: ObservableObject {
    @Published var selectedTab: AppTab = .myTasks
    @Published var path: [AppRoute] = []

    func navigate(to route: AppRoute) { path.append(route) }
    func goBack() { if !path.isEmpty { path.removeLast() } }
    func reset() { path.removeAll() }
}
