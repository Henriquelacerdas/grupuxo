import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

@main
struct DomesticApp: App {
    @StateObject private var authService = AuthService()
    init() {
        do {
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
        }
    }
}
