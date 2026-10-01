import Foundation
import Amplify
import AWSCognitoAuthPlugin
import SwiftUI
import Combine

@MainActor
class AuthService: ObservableObject {
    @Published var isSignedIn = false
    
    // Verifica se o usuário já está logado ao abrir o app
    func checkSession() async {
        do {
            let session = try await Amplify.Auth.fetchAuthSession()
            self.isSignedIn = session.isSignedIn
        } catch {
            print("Erro ao verificar sessão: \(error)")
            self.isSignedIn = false
        }
    }
    
    // Faz o login
    func signIn(username: String, password: String) async {
        do {
            let result = try await Amplify.Auth.signIn(username: username, password: password)
            if result.isSignedIn {
                self.isSignedIn = true
                print("Login com sucesso!")
            } else {
                print("Login requer confirmação adicional (ex: MFA ou confirmar email).")
            }
        } catch {
            print("Erro no login: \(error)")
        }
    }
    
    // Faz o logout
    func signOut() async {
        let result = await Amplify.Auth.signOut(options: .init(globalSignOut: false))

        if let result = result as? AWSCognitoSignOutResult {
            switch result {
            case .complete, .partial:
                isSignedIn = false   // ajuste para a propriedade que você já usa
            case .failed(let error):
                print("Erro no logout: \(error)")
            }
        }
    }
    
    // Faz o cadastro de um novo usuário
    func signUp(username: String, email: String, password: String) async -> Bool {
        // O Cognito geralmente exige o email como um atributo adicional
        let userAttributes = [AuthUserAttribute(.email, value: email)]
        let options = AuthSignUpRequest.Options(userAttributes: userAttributes)
        
        do {
            let result = try await Amplify.Auth.signUp(
                username: username,
                password: password,
                options: options
            )
            print("Cadastro iniciado. Próximo passo: \(result.nextStep)")
            return true // Sucesso na primeira etapa, precisa confirmar o código
        } catch {
            print("Erro no cadastro: \(error)")
            return false
        }
    }
    
    // Confirma o código enviado para o email
    func confirmSignUp(username: String, code: String) async -> Bool {
        do {
            let result = try await Amplify.Auth.confirmSignUp(for: username, confirmationCode: code)
            if result.isSignUpComplete {
                print("Cadastro confirmado com sucesso!")
                return true
            } else {
                return false
            }
        } catch {
            print("Erro na confirmação: \(error)")
            return false
        }
    }
    
    func signInWithApple() async {
        // Pega a janela principal do app para ancorar a tela da Apple
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) else {
            print("Erro: Não encontrou a janela principal do app.")
            return
        }
        
        do {
            let result = try await Amplify.Auth.signInWithWebUI(
                for: .apple,
                presentationAnchor: window
            )
            
            if result.isSignedIn {
                self.isSignedIn = true
                print("Login com Apple realizado com sucesso!")
            }
        } catch {
            print("Erro no login com Apple: \(error)")
        }
    }
}
