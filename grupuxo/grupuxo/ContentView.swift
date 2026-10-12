import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var houses: HouseService

    var body: some View {
        Group {
            if authService.isSignedIn {
                // Logado: sem casa → Onboarding; com casa → app principal (abas)
                HouseGateView {
                    // Estado novo por conta: sem o id, trocar de usuário reaproveitaria o store do anterior.
                    RootView()
                        .id(houses.currentUserId)
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
        .onChange(of: houses.loadError) { _, error in
            // Sessão vencida descoberta pela API: volta ao login (o signOut limpa o estado local).
            if error == .sessionExpired { Task { await authService.signOut() } }
        }
        .onChange(of: authService.isSignedIn) { _, signedIn in
            // Logout (de qualquer tela) limpa o estado da casa
            if !signedIn { houses.reset() }
        }
    }
}
