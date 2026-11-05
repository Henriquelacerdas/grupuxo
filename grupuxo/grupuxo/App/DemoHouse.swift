#if DEBUG
import Foundation
import GrupuxoDomain
import SwiftUI

/// Casa de demonstração sobre o `MockStore`, só em Debug: abre as abas sem login nem `api`,
/// para conferir as telas no simulador e nos testes de UI. Ativa com o argumento de lançamento `-DemoHouse`.
enum DemoHouse {

    static let launchArgument = "-DemoHouse"

    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains(launchArgument)
    }
}

/// Raiz do app na casa de demonstração: os mesmos `RootView` e use cases, com repositórios `Mock*`.
struct DemoHouseRootView: View {

    @StateObject private var model = RootModel(
        container: AppContainer(),
        session: AppSession(
            currentUser: MockSeed.currentUser,
            currentHouse: MockSeed.house
        )
    )

    var body: some View {
        RootView(model: model)
    }
}
#endif
