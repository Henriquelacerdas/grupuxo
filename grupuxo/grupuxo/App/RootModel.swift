import Combine
import Foundation
import GrupuxoDomain

/// Dono do `AppContainer` (e do `MockStore` dentro dele) e da `AppSession` da casa aberta.
///
/// Fica num `@StateObject` do `RootView`: o SwiftUI cria o modelo uma vez por identidade da view e o
/// mantém quando a struct `RootView` é reconstruída (o `HouseGateView` reavalia o conteúdo a cada
/// `@Published` do `HouseService`). Por isso ações na casa não trocam o store.
@MainActor
final class RootModel: ObservableObject {

    let container: AppContainer
    let session: AppSession

    @Published private(set) var isSynced = false

    init(
        container: AppContainer = AppContainer(store: MockStore(state: MockSeed.empty())),
        session: AppSession = AppSession(
            currentUser: User(id: UUID(), name: "", email: nil),
            currentHouse: House(id: UUID(), name: "", accessCode: "", createdAt: .now)
        )
    ) {
        self.container = container
        self.session = session
    }

    /// Reflete a casa real no store e só então atualiza a sessão (morador e casa reais).
    func apply(_ snapshot: HouseSnapshot, user: User, house: House) async throws {
        try await container.sync(snapshot)
        objectWillChange.send()
        session.currentUser = user
        session.currentHouse = house
        isSynced = true
    }
}
