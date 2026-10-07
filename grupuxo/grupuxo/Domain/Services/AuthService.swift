import Foundation
import Amplify
import AWSCognitoAuthPlugin
import SwiftUI
import Combine

@MainActor
class AuthService: ObservableObject {
    @Published var isSignedIn = false
    
    enum SignInStatus {
        case success
        case confirmSignUp
        case resetPassword
        case invalidCredentials
        case error(String)
    }
    
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
    func signIn(username: String, password: String) async -> SignInStatus {
        do {
            let result = try await Amplify.Auth.signIn(username: username, password: password)
            if result.isSignedIn {
                self.isSignedIn = true
                print("Login com sucesso!")
                return .success
            } else {
                switch result.nextStep {
                case .confirmSignUp:
                    return .confirmSignUp
                case .resetPassword:
                    return .resetPassword
                default:
                    return .error("O login requer um passo adicional.")
                }
            }
        } catch let error as AuthError {
            if case .notAuthorized = error {
                return .invalidCredentials
            }
            return .error(error.errorDescription)
        } catch {
            print("Erro no login: \(error)")
            return .error(error.localizedDescription)
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
    
    // Reenvia código de confirmação
    func resendSignUpCode(username: String) async -> Bool {
        do {
            _ = try await Amplify.Auth.resendSignUpCode(for: username)
            return true
        } catch {
            print("Erro ao reenviar código: \(error)")
            return false
        }
    }
    
    // Inicia fluxo de redefinição de senha
    func resetPassword(username: String) async -> Bool {
        do {
            _ = try await Amplify.Auth.resetPassword(for: username)
            return true
        } catch {
            print("Erro ao solicitar redefinição: \(error)")
            return false
        }
    }
    
    // Confirma fluxo de redefinição de senha
    func confirmResetPassword(username: String, newPassword: String, code: String) async -> Bool {
        do {
            try await Amplify.Auth.confirmResetPassword(for: username, with: newPassword, confirmationCode: code)
            return true
        } catch {
            print("Erro ao confirmar redefinição: \(error)")
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
