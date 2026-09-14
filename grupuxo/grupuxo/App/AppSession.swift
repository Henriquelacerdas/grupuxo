import Combine

@MainActor
final class AppSession: ObservableObject {
    @Published var currentUser: User
    @Published var currentHouse: House

    init(currentUser: User, currentHouse: House) {
        self.currentUser = currentUser
        self.currentHouse = currentHouse
    }
}
