import Foundation
import SwiftUI

/// Redefinição de senha: e-mail → código que o Cognito manda → senha nova (e já entra).
struct ForgotPasswordView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    @State var username: String = ""
    @State private var newPassword = ""
    @State private var confirmationCode = ""
    @State private var step: Step = .request
    @State private var message = ""
    @State private var isError = true
    @State private var isWorking = false
    @State private var showOffline = false

    enum Step {
        case request
        case code
        case newPassword
    }

    private var email: String { AuthService.normalizedEmail(username) }

    var body: some View {
        AuthScreen {
            switch step {
            case .request:
                AuthHeader(
                    title: "Esqueceu a senha?",
                    subtitle: "Digite seu e-mail. Vamos mandar um código para você criar uma senha nova."
                )
                AuthFieldGroup {
                    TextField("E-mail", text: $username)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .authField()
                }
            case .code:
                AuthCheckEmailHeader(email: email)
                AuthCodeField(code: $confirmationCode)
                    .padding(.top, DesignSystem.Spacing.large)
            case .newPassword:
                AuthHeader(
                    title: "Crie uma senha nova",
                    subtitle: "Depois disso, você entra direto no Reveza."
                )
                VStack(spacing: DesignSystem.Spacing.medium) {
                    AuthFieldGroup {
                        SecureField("Senha nova", text: $newPassword)
                            .textContentType(.newPassword)
                            .authField()
                    }
                    if message.isEmpty {
                        AuthFootnote(text: AuthService.passwordRules)
                    }
                }
            }

            if !message.isEmpty {
                AuthFootnote(text: message, isError: isError)
            }
        } footer: {
            switch step {
            case .request:
                Button {
                    Task { await requestCode() }
                } label: {
                    AuthButtonLabel(title: "Enviar código", isWorking: isWorking)
                }
                .buttonStyle(.authPrimary)
                .disabled(email.isEmpty || isWorking)
            case .code:
                Button("Continuar") {
                    message = ""
                    step = .newPassword
                }
                .buttonStyle(.authPrimary)
                .disabled(confirmationCode.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Reenviar código") {
                    Task { await requestCode() }
                }
                .font(.callout)
                .disabled(isWorking)
            case .newPassword:
                Button {
                    Task { await saveAndSignIn() }
                } label: {
                    AuthButtonLabel(title: "Salvar e entrar", isWorking: isWorking)
                }
                .buttonStyle(.authPrimary)
                .disabled(newPassword.isEmpty || isWorking)
            }
        }
        .offlineAlert(isPresented: $showOffline)
    }

    private func requestCode() async {
        message = ""
        isWorking = true
        defer { isWorking = false }
        switch await authService.resetPassword(username: username) {
        case .done:
            if step == .code {
                show(String(localized: "Enviamos um novo código para \(email)."), error: false)
            }
            step = .code
        case .offline:
            showOffline = true
        case .invalidCode(let failure), .failed(let failure):
            show(failure, error: true)
        }
    }

    private func saveAndSignIn() async {
        message = ""
        isWorking = true
        defer { isWorking = false }
        switch await authService.confirmResetPassword(username: username, newPassword: newPassword, code: confirmationCode) {
        case .done:
            break
        case .offline:
            showOffline = true
            return
        case .invalidCode(let failure):
            step = .code
            show(failure, error: true)
            return
        case .failed(let failure):
            show(failure, error: true)
            return
        }
        // Senha trocada: entra direto; o app troca de tela quando `isSignedIn` muda.
        switch await authService.signIn(username: username, password: newPassword) {
        case .success, .cancelled:
            break
        case .offline:
            showOffline = true
        case .error(let failure):
            show(String(localized: "Senha alterada, mas não deu para entrar: \(failure)"), error: true)
        default:
            show(String(localized: "Senha alterada. Volte e entre com a senha nova."), error: false)
        }
    }

    private func show(_ text: String, error: Bool) {
        message = text
        isError = error
    }
}
