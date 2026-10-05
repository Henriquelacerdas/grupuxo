import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    
    var body: some View {
        Group {
            if authService.isSignedIn {
                // Se estiver logado, carrega a vista principal com as abas e toda a injeção do Container
                RootView()
            } else {
                // Se não estiver logado, mostra a interface de autenticação
                LoginView()
            }
        }
        .task {
            // Verifica o estado da sessão assim que o app arranca
            await authService.checkSession()
        }
    }
}
