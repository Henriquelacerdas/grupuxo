#if DEBUG
import Foundation
import GrupuxoDomain
import SwiftUI

/// Casa de demonstração sobre o `MockStore`, só em Debug: abre as abas sem login nem `api`,
/// para conferir as telas no simulador e nos testes de UI. Ativa com o argumento de lançamento `-DemoHouse`.
enum DemoHouse {

    static let launchArgument = "-DemoHouse"

    static let onboardingArgument = "-DemoOnboarding"

    /// Passo do onboarding a abrir (`-DemoOnboarding 3`; 0 = primeiro).
    static var onboardingStep: Int? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: onboardingArgument) else { return nil }
        return arguments.indices.contains(index + 1) ? Int(arguments[index + 1]) ?? 0 : 0
    }

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

/// Onboarding sem login nem `api`, para conferir os textos e o layout de cada passo.
struct DemoOnboardingRootView: View {
    let step: Int
    @State private var isFinishing = false
    @StateObject private var houses = RemoteHouseSession(api: nil)
    @StateObject private var authService = AuthService()
    @StateObject private var push = PushRegistration()

    @ViewBuilder
    private var screen: some View {
        switch step {
        case 100: WelcomeView(onContinue: {})
        case 101: NavigationStack { LoginView() }
        case 102: NavigationStack { SignUpView(email: .constant("")) }
        default: OnboardingView(isFinishing: $isFinishing, debugStep: step)
        }
    }

    var body: some View {
        screen
            .environmentObject(houses)
            .environmentObject(authService)
            .environmentObject(push)
    }
}
#endif
