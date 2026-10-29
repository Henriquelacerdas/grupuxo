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
        /// O usuário fechou a folha de login (Apple); não é erro.
        case cancelled
        /// Sem internet: a tela mostra o alerta "Sem conexão".
        case offline
        case error(String)
    }

    enum SignUpOutcome: Equatable {
        /// Conta criada; falta o código enviado por e-mail.
        case confirmationRequired
        /// Conta criada e já confirmada (o pool não pediu código).
        case completed
        /// Já existe conta com este e-mail: o caminho é entrar (ou confirmar, se nunca confirmou).
        case alreadyExists
        case offline
        case failed(String)
    }

    /// Resultado de pedir o código de redefinição e de gravar a senha nova.
    enum PasswordResetOutcome: Equatable {
        case done
        case offline
        /// Código errado ou vencido: a tela volta ao passo do código.
        case invalidCode(String)
        case failed(String)
    }

    enum DeleteAccountOutcome: Equatable {
        case deleted
        case offline
        case failed(String)
    }

    enum ConfirmSignUpOutcome: Equatable {
        case confirmed
        case failed(String)
    }

    /// Regras de senha do user pool (`amplify_outputs.json`), mostradas no cadastro.
    static let passwordRules = String(localized: "Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e símbolo.")

    /// O e-mail é o nome de usuário no Cognito: sem espaços nas pontas (o teclado e o preenchimento automático
    /// costumam deixar um no fim) e em minúsculas, para o cadastro e o login sempre baterem.
    nonisolated static func normalizedEmail(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private let client: any AuthSessionClient
    private var eventsTask: Task<Void, Never>?

    init(client: any AuthSessionClient = AmplifyAuthSessionClient()) {
        self.client = client
    }

    deinit {
        eventsTask?.cancel()
    }

    // Verifica se o usuário já está logado ao abrir o app
    func checkSession() async {
        startObservingSession()
        do {
            let session = try await client.fetchSession()
            // Sessão vencida ou encerrada desloga; sem rede (.unavailable) quem já está logado continua.
            self.isSignedIn = session.isActive
        } catch {
            // Não sabemos o estado: não derruba nem promove ninguém.
            print("Erro ao verificar sessão: \(error)")
        }
    }

    /// Escuta o Hub: sessão vencida ou logout com o app aberto voltam ao login.
    private func startObservingSession() {
        guard eventsTask == nil else { return }
        let events = client.events()
        eventsTask = Task { [weak self] in
            for await _ in events {
                self?.isSignedIn = false
            }
        }
    }

    // Faz o login
    func signIn(username: String, password: String) async -> SignInStatus {
        let email = Self.normalizedEmail(username)
        guard !email.isEmpty, !password.isEmpty else { return .error(String(localized: "Informe o e-mail e a senha.")) }
        await client.clearStaleSession()
        do {
            let result = try await Amplify.Auth.signIn(username: email, password: password)
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
                    return .error(String(localized: "O login requer um passo adicional."))
                }
            }
        } catch let error as AuthError {
            print("Erro no login: \(error)")
            if case .notAuthorized = error {
                return .invalidCredentials
            }
            switch Self.cognitoError(error) {
            case .userNotConfirmed: return .confirmSignUp
            case .passwordResetRequired: return .resetPassword
            case .userNotFound: return .invalidCredentials
            case .network: return .offline
            default: return .error(Self.message(for: error))
            }
        } catch {
            print("Erro no login: \(error)")
            return .error(Self.message(for: error))
        }
    }
    
    // Faz o logout. Mesmo se o Cognito falhar (ex.: sem rede), o estado local é limpo.
    func signOut() async {
        let outcome = await client.signOut()
        if outcome == .failed {
            print("Logout remoto falhou; limpando o estado local.")
        }
        isSignedIn = false
    }

    /// Apaga a conta no Cognito (o servidor já apagou os dados). Quem chama confirma com o morador antes.
    func deleteAccount() async -> DeleteAccountOutcome {
        do {
            try await client.deleteUser()
            isSignedIn = false
            return .deleted
        } catch let error as AuthError {
            print("Erro ao excluir a conta: \(error)")
            if case .network = Self.cognitoError(error) { return .offline }
            return .failed(Self.message(for: error))
        } catch {
            print("Erro ao excluir a conta: \(error)")
            return .failed(Self.message(for: error))
        }
    }

    // Faz o cadastro de um novo usuário (o e-mail é o nome de usuário no Cognito).
    func signUp(email rawEmail: String, password: String) async -> SignUpOutcome {
        let email = Self.normalizedEmail(rawEmail)
        guard !email.isEmpty, !password.isEmpty else { return .failed(String(localized: "Informe o e-mail e a senha.")) }
        let options = AuthSignUpRequest.Options(userAttributes: [AuthUserAttribute(.email, value: email)])
        do {
            let result = try await Amplify.Auth.signUp(username: email, password: password, options: options)
            if case .done = result.nextStep { return .completed }
            return .confirmationRequired
        } catch let error as AuthError {
            print("Erro no cadastro: \(error)")
            switch Self.cognitoError(error) {
            case .usernameExists, .aliasExists: return .alreadyExists
            case .network: return .offline
            case .invalidPassword: return .failed(String(localized: "Senha fraca. \(Self.passwordRules)"))
            case .invalidParameter: return .failed(String(localized: "Confira o e-mail e a senha. \(Self.passwordRules)"))
            default: return .failed(Self.message(for: error))
            }
        } catch {
            print("Erro no cadastro: \(error)")
            return .failed(Self.message(for: error))
        }
    }

    func confirmSignUp(email rawEmail: String, code rawCode: String) async -> ConfirmSignUpOutcome {
        let email = Self.normalizedEmail(rawEmail)
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty, !code.isEmpty else { return .failed(String(localized: "Informe o e-mail e o código.")) }
        do {
            let result = try await Amplify.Auth.confirmSignUp(for: email, confirmationCode: code)
            return result.isSignUpComplete ? .confirmed : .failed(String(localized: "Não foi possível confirmar a conta. Tente de novo."))
        } catch let error as AuthError {
            print("Erro na confirmação: \(error)")
            // O Cognito responde "não autorizado" ao confirmar uma conta que já está confirmada.
            if case .notAuthorized = error { return .confirmed }
            switch Self.cognitoError(error) {
            case .codeMismatch: return .failed(String(localized: "Código incorreto. Confira o último e-mail recebido."))
            case .codeExpired: return .failed(String(localized: "O código expirou. Toque em \"Reenviar código\"."))
            case .aliasExists: return .failed(String(localized: "Já existe outra conta confirmada com este e-mail. Entre com ela."))
            case .userNotFound: return .failed(String(localized: "Não encontramos uma conta com este e-mail. Cadastre-se de novo."))
            default: return .failed(Self.message(for: error))
            }
        } catch {
            print("Erro na confirmação: \(error)")
            return .failed(Self.message(for: error))
        }
    }

    /// Reenvia o código de confirmação. `nil` = enviado; senão, a mensagem do erro.
    func resendSignUpCode(email rawEmail: String) async -> String? {
        let email = Self.normalizedEmail(rawEmail)
        guard !email.isEmpty else { return String(localized: "Informe o e-mail.") }
        do {
            _ = try await Amplify.Auth.resendSignUpCode(for: email)
            return nil
        } catch let error as AuthError {
            print("Erro ao reenviar código: \(error)")
            // Conta já confirmada: o Cognito recusa o reenvio ("User is already confirmed"); basta entrar.
            if case .service(let description, _, _) = error, Self.cognitoError(error) == .invalidParameter,
               description.localizedCaseInsensitiveContains("confirmed") {
                return String(localized: "Esta conta já está confirmada. Volte e entre com sua senha.")
            }
            return Self.message(for: error)
        } catch {
            print("Erro ao reenviar código: \(error)")
            return Self.message(for: error)
        }
    }

    // Inicia fluxo de redefinição de senha: o Cognito manda um código por e-mail.
    func resetPassword(username: String) async -> PasswordResetOutcome {
        let email = Self.normalizedEmail(username)
        guard !email.isEmpty else { return .failed(String(localized: "Informe o e-mail.")) }
        do {
            _ = try await Amplify.Auth.resetPassword(for: email)
            return .done
        } catch let error as AuthError {
            print("Erro ao solicitar redefinição: \(error)")
            switch Self.cognitoError(error) {
            case .network: return .offline
            case .userNotFound: return .failed(String(localized: "Não encontramos uma conta com este e-mail."))
            default: return .failed(Self.message(for: error))
            }
        } catch {
            print("Erro ao solicitar redefinição: \(error)")
            return .failed(Self.message(for: error))
        }
    }

    // Confirma fluxo de redefinição de senha
    func confirmResetPassword(username: String, newPassword: String, code: String) async -> PasswordResetOutcome {
        do {
            try await Amplify.Auth.confirmResetPassword(
                for: Self.normalizedEmail(username),
                with: newPassword,
                confirmationCode: code.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            return .done
        } catch let error as AuthError {
            print("Erro ao confirmar redefinição: \(error)")
            switch Self.cognitoError(error) {
            case .network: return .offline
            case .codeMismatch: return .invalidCode(String(localized: "Código incorreto. Confira o último e-mail recebido."))
            case .codeExpired: return .invalidCode(String(localized: "O código expirou. Toque em \"Reenviar código\"."))
            case .invalidPassword: return .failed(String(localized: "Senha fraca. \(Self.passwordRules)"))
            default: return .failed(Self.message(for: error))
            }
        } catch {
            print("Erro ao confirmar redefinição: \(error)")
            return .failed(Self.message(for: error))
        }
    }

    // MARK: - Erros do Cognito

    private static func cognitoError(_ error: AuthError) -> AWSCognitoAuthError? {
        switch error {
        case .service(_, _, let underlying), .notAuthorized(_, _, let underlying), .validation(_, _, _, let underlying),
             .unknown(_, let underlying):
            return underlying as? AWSCognitoAuthError
        default:
            return nil
        }
    }

    /// Mensagem em português para o usuário; o texto do Cognito (em inglês) só vai para o log.
    private static func message(for error: Error) -> String {
        guard let error = error as? AuthError else {
            return String(localized: "Não foi possível concluir agora. Tente de novo em instantes.")
        }
        switch cognitoError(error) {
        case .network:
            return String(localized: "Sem conexão com a internet. Tente de novo.")
        case .limitExceeded, .requestLimitExceeded, .failedAttemptsLimitExceeded:
            return String(localized: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.")
        case .codeDelivery:
            return String(localized: "Não conseguimos enviar o e-mail com o código. Tente de novo em alguns minutos.")
        case .userNotConfirmed:
            return String(localized: "Confirme seu e-mail com o código que enviamos antes de entrar.")
        default:
            return String(localized: "Não foi possível concluir agora. Tente de novo em instantes.")
        }
    }

    func signInWithApple() async -> SignInStatus {
        // Pega a janela principal do app para ancorar a tela da Apple
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) else {
            print("Erro: Não encontrou a janela principal do app.")
            return .error(String(localized: "Não foi possível abrir o login com a Apple."))
        }

        await client.clearStaleSession()
        do {
            let result = try await Amplify.Auth.signInWithWebUI(
                for: .apple,
                presentationAnchor: window
            )

            guard result.isSignedIn else {
                return .error(String(localized: "O login com a Apple não foi concluído."))
            }
            self.isSignedIn = true
            print("Login com Apple realizado com sucesso!")
            return .success
        } catch let error as AuthError {
            if case .service(_, _, let underlying) = error,
               let cognito = underlying as? AWSCognitoAuthError, cognito == .userCancelled {
                return .cancelled
            }
            print("Erro no login com Apple: \(error)")
            if Self.cognitoError(error) == .network { return .offline }
            return .error(Self.message(for: error))
        } catch {
            print("Erro no login com Apple: \(error)")
            return .error(Self.message(for: error))
        }
    }
}
