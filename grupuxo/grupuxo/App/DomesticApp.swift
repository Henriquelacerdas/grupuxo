import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

@main
struct DomesticApp: App {
    @StateObject private var authService = AuthService()
    @StateObject private var houses = DomesticApp.makeHouseSession()
    @StateObject private var push = PushRegistration()
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var appDelegate

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
            root
                .environmentObject(authService)
                .environmentObject(houses)
                .environmentObject(push)
                .task {
                    appDelegate.registration = push
                    // O token vai ao servidor assim que houver conta; quem já autorizou renova o registro a cada abertura.
                    push.sendToken = { [houses] token, environment in
                        guard let api = houses.api else { return false }
                        return (try? await api.send("PUT", "v1/me/devices", body: DeviceBody(token: token, environment: environment))) != nil
                    }
                    await push.resumeIfAuthorized()
                }
        }
    }

    @ViewBuilder
    private var root: some View {
        #if DEBUG
        if DemoHouse.isEnabled {
            DemoHouseRootView()
        } else {
            ContentView()
        }
        #else
        ContentView()
        #endif
    }

    /// Falha fechado: sem `GRUPUXO_API_BASE_URL` o app mostra o erro em vez de falar com um servidor qualquer.
    private static func makeHouseSession() -> RemoteHouseSession {
        do {
            let configuration = try APIConfiguration()
            let api = APIClient(baseURL: configuration.baseURL, tokens: AmplifyAccessTokenProvider())
            return RemoteHouseSession(api: api, prefersSnapshot: true)
        } catch {
            return RemoteHouseSession(api: nil, configurationError: error.localizedDescription)
        }
    }
}
