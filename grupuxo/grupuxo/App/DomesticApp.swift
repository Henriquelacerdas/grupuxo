import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

@main
struct DomesticApp: App {
    @StateObject private var authService = AuthService()
    @StateObject private var houses = DomesticApp.makeHouseSession()

    init() {
        do {
            // Só o Auth do Amplify (login com Cognito); casa, cômodos e tarefas vêm da `api` do servidor.
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure(with: .amplifyOutputs)
            print("Amplify configurado")
        } catch {
            print("Erro ao configurar Amplify: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authService)
                .environmentObject(houses)
        }
    }

    /// Falha fechado: sem `GRUPUXO_API_BASE_URL` o app mostra o erro em vez de falar com um servidor qualquer.
    private static func makeHouseSession() -> RemoteHouseSession {
        do {
            let configuration = try APIConfiguration()
            let api = APIClient(baseURL: configuration.baseURL, tokens: AmplifyAccessTokenProvider())
            return RemoteHouseSession(api: api)
        } catch {
            return RemoteHouseSession(api: nil, configurationError: error.localizedDescription)
        }
    }
}
