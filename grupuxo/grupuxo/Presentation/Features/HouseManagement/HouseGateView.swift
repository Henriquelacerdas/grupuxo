import GrupuxoDomain
import SwiftUI

/// Decide o que mostrar para o usuário logado:
/// carregando → erro → Onboarding (sem casa, ou terminando o passo "Convidar") → conteúdo do app (com casa).
struct HouseGateView<Content: View>: View {
    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService
    @ViewBuilder var content: () -> Content
    @State private var confirmSignOut = false
    /// Verdadeiro enquanto o onboarding mostra o passo "Convidar", depois de a casa já existir.
    @State private var isFinishingOnboarding = false

    var body: some View {
        Group {
            if !houses.hasLoaded {
                ProgressView("Carregando sua casa…")
            } else if houses.house != nil, !isFinishingOnboarding {
                content()
            } else if let error = houses.loadError {
                ContentUnavailableView {
                    Label("Não foi possível carregar", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error.message)
                } actions: {
                    Button("Tentar novamente") { Task { await houses.load() } }
                        .buttonStyle(.borderedProminent)
                    Button("Sair da conta", role: .destructive) { confirmSignOut = true }
                    DeleteAccountButton()
                }
            } else {
                OnboardingView(isFinishing: $isFinishingOnboarding)
            }
        }
        .confirmationDialog("Sair da conta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sair da conta", role: .destructive) { Task { await authService.signOut() } }
        }
        .animation(.default, value: houses.house?.id)
        .task {
            if !houses.hasLoaded { await houses.load() }
        }
    }
}
