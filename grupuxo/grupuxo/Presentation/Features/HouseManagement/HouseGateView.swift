import GrupuxoDomain
import SwiftUI

/// Decide o que mostrar para o usuário logado:
/// carregando → erro → Onboarding (sem casa) → conteúdo do app (com casa).
struct HouseGateView<Content: View>: View {
    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService
    @ViewBuilder var content: () -> Content

    var body: some View {
        Group {
            if !houses.hasLoaded {
                ProgressView("Carregando sua casa…")
            } else if houses.house != nil {
                content()
            } else if let error = houses.loadError {
                ContentUnavailableView {
                    Label("Não foi possível carregar", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error.message)
                } actions: {
                    Button("Tentar novamente") { Task { await houses.load() } }
                        .buttonStyle(.borderedProminent)
                    Button("Sair da conta", role: .destructive) { Task { await authService.signOut() } }
                    DeleteAccountButton()
                }
            } else {
                OnboardingView()
            }
        }
        .animation(.default, value: houses.house?.id)
        .task {
            if !houses.hasLoaded { await houses.load() }
        }
    }
}
