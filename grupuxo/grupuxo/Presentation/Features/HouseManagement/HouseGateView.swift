import SwiftUI

/// Decide o que mostrar para o usuário logado:
/// carregando → erro → Onboarding (sem casa) → conteúdo do app (com casa).
struct HouseGateView<Content: View>: View {
    @EnvironmentObject private var houses: HouseService
    @ViewBuilder var content: () -> Content

    var body: some View {
        Group {
            if !houses.hasLoaded {
                ProgressView("Carregando sua casa…")
            } else if houses.house != nil {
                content()
            } else if let message = houses.loadError {
                ContentUnavailableView {
                    Label("Não foi possível carregar", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Tentar novamente") { Task { await houses.load() } }
                        .buttonStyle(.borderedProminent)
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
