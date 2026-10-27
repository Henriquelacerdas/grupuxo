import GrupuxoDomain
import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var houses: RemoteHouseSession

    var body: some View {
        Group {
            if authService.isSignedIn {
                // Logado: sem casa → Onboarding; com casa → app principal (abas)
                HouseGateView {
                    if let api = houses.api, let me = houses.me, let house = houses.house {
                        // Estado novo por conta e por casa: sem o id, trocar de usuário reaproveitaria o anterior.
                        RootView(api: api, user: me, house: house, myHouse: houses.dataCache)
                            .id("\(me.id)-\(house.id)")
                    }
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
