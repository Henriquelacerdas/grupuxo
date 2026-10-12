import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var houses: HouseService

    var body: some View {
        Group {
            if authService.isSignedIn {
                // Logado: sem casa → Onboarding; com casa → app principal (abas)
                HouseGateView {
                    RootView()
                }
            } else {
                // Se não estiver logado, mostra a interface de autenticação
                LoginView()
            }
        }
        .task {
            // Verifica o estado da sessão assim que o app arranca
            await authService.checkSession()
        }
        .onChange(of: authService.isSignedIn) { _, signedIn in
            // Logout (de qualquer tela) limpa o estado da casa
            if !signedIn { houses.reset() }
        }
    }
}
