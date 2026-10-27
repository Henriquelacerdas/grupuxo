import Combine
import Foundation
import GrupuxoDomain

/// Dono do `AppContainer` e da `AppSession` da casa aberta.
///
/// Fica num `@StateObject` do `RootView`: o SwiftUI cria o modelo uma vez por identidade da view e o mantém
/// quando a struct `RootView` é reconstruída. O cache da sessão compartilha as leituras da `api` por 5 s (BACKEND.md seção 6).
@MainActor
final class RootModel: ObservableObject {

    let container: AppContainer
    let session: AppSession

    init(container: AppContainer, session: AppSession) {
        self.container = container
        self.session = session
    }

    convenience init(api: APIClient, user: User, house: House, myHouse: MyHouseCache? = nil) {
        self.init(
            container: AppContainer(api: api, myHouse: myHouse),
            session: AppSession(currentUser: user, currentHouse: house)
        )
    }
}
