import Foundation
import SwiftUI

struct ConfirmSignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    let email: String
    /// Senha digitada no cadastro ou no login: com ela, confirmar já entra no app.
    let password: String?
    /// Vindo do login de uma conta nunca confirmada, o código antigo pode ter expirado ou se perdido: manda outro.
    let sendCodeOnAppear: Bool

    @State private var code = ""
    @State private var message = ""
    @State private var isError = false
    @State private var isConfirmed = false
    @State private var isWorking = false
    @State private var sentOnAppear = false

    init(email: String, password: String? = nil, sendCodeOnAppear: Bool = false) {
        self.email = email
        self.password = password
        self.sendCodeOnAppear = sendCodeOnAppear
    }

    var body: some View {
        AuthScreen {
            AuthCheckEmailHeader(email: email)

            VStack(spacing: DesignSystem.Spacing.medium) {
                AuthCodeField(code: $code)
                    .disabled(isConfirmed)
                if !message.isEmpty {
                    AuthFootnote(text: message, isError: isError)
                }
            }
            .padding(.top, DesignSystem.Spacing.large)
        } footer: {
            if isConfirmed {
                Button("Voltar para o login") { dismiss() }
                    .buttonStyle(.authPrimary)
            } else {
                Button {
                    Task { await confirm() }
                } label: {
                    AuthButtonLabel(title: "Continuar", isWorking: isWorking)
                }
                .buttonStyle(.authPrimary)
                .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                Button("Reenviar código") {
                    Task { await resend() }
                }
                .font(.callout)
                .disabled(isWorking)
            }
        }
        .task {
            guard sendCodeOnAppear, !sentOnAppear else { return }
            sentOnAppear = true
            await resend()
        }
    }

    private func confirm() async {
        isWorking = true
        defer { isWorking = false }
        switch await authService.confirmSignUp(email: email, code: code) {
        case .confirmed:
            isConfirmed = true
            await signInIfPossible()
        case .failed(let failure):
            show(failure, error: true)
        }
    }

    /// Com a senha em mãos, entra direto; o app troca de tela quando `isSignedIn` muda.
    private func signInIfPossible() async {
        guard let password, !password.isEmpty else {
            show(String(localized: "Conta confirmada! Você já pode fazer login."), error: false)
            return
        }
        switch await authService.signIn(username: email, password: password) {
        case .success, .cancelled:
            show(String(localized: "Conta confirmada!"), error: false)
        case .error(let failure):
            show(String(localized: "Conta confirmada, mas não deu para entrar: \(failure)"), error: true)
        default:
            show(String(localized: "Conta confirmada! Volte e entre com seu e-mail e senha."), error: false)
        }
    }

    private func resend() async {
        isWorking = true
        defer { isWorking = false }
        if let failure = await authService.resendSignUpCode(email: email) {
            show(failure, error: true)
        } else {
            show(String(localized: "Enviamos um novo código para \(AuthService.normalizedEmail(email))."), error: false)
        }
    }

    private func show(_ text: String, error: Bool) {
        message = text
        isError = error
    }
}
