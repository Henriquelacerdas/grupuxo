import Foundation
import SwiftUI

struct SignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    /// O mesmo e-mail do login: voltar com "Entrar com esse e-mail" já leva o endereço preenchido.
    @Binding var email: String
    @State private var password = ""

    @State private var showConfirmation = false
    @State private var errorMessage = ""
    @State private var isWorking = false
    @State private var showOffline = false
    /// O e-mail já tem conta e a senha digitada não entra: o rodapé oferece entrar ou recuperar a senha.
    @State private var emailTaken = false

    private var canSubmit: Bool {
        !AuthService.normalizedEmail(email).isEmpty && !password.isEmpty && !isWorking
    }

    var body: some View {
        AuthScreen {
            AuthHeader(
                title: "Criar conta",
                subtitle: "Use um e-mail que você acessa. É por ele que você recupera a senha."
            )

            VStack(spacing: DesignSystem.Spacing.medium) {
                AuthFieldGroup {
                    TextField("E-mail", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .authField()
                    AuthFieldDivider()
                    SecureField("Senha", text: $password)
                        .textContentType(.newPassword)
                        .authField()
                }

                if !errorMessage.isEmpty {
                    AuthFootnote(text: errorMessage, isError: true)
                } else {
                    AuthFootnote(text: AuthService.passwordRules)
                }
            }
        } footer: {
            if emailTaken {
                Button("Entrar com esse e-mail") { dismiss() }
                    .buttonStyle(.authPrimary)
                NavigationLink("Esqueci a senha") {
                    ForgotPasswordView(username: AuthService.normalizedEmail(email))
                }
                .font(.callout)
            } else {
                Button {
                    Task { await signUp() }
                } label: {
                    AuthButtonLabel(title: "Criar conta", isWorking: isWorking)
                }
                .buttonStyle(.authPrimary)
                .disabled(!canSubmit)
                Button("Já tenho uma conta") { dismiss() }
                    .font(.callout)
            }
        }
        .onChange(of: email) {
            emailTaken = false
            errorMessage = ""
        }
        .navigationDestination(isPresented: $showConfirmation) {
            ConfirmSignUpView(email: AuthService.normalizedEmail(email), password: password)
        }
        .offlineAlert(isPresented: $showOffline)
    }

    private func signUp() async {
        errorMessage = ""
        isWorking = true
        defer { isWorking = false }
        switch await authService.signUp(email: email, password: password) {
        case .confirmationRequired:
            showConfirmation = true
        case .completed:
            await signInAfterSignUp()
        case .alreadyExists:
            // Comum depois de um cadastro sem confirmação: tenta entrar e, se faltar confirmar, leva ao código.
            await signInAfterSignUp(existing: true)
        case .offline:
            showOffline = true
        case .failed(let message):
            errorMessage = message
        }
    }

    private func signInAfterSignUp(existing: Bool = false) async {
        switch await authService.signIn(username: email, password: password) {
        case .success, .cancelled:
            break
        case .confirmSignUp:
            showConfirmation = true
        case .invalidCredentials where existing:
            errorMessage = String(localized: "Esse e-mail já tem uma conta no Reveza.")
            emailTaken = true
        case .resetPassword:
            errorMessage = String(localized: "Redefinição de senha necessária. Toque em Esqueci a senha.")
            emailTaken = true
        case .invalidCredentials:
            errorMessage = String(localized: "Conta criada. Volte e entre com seu e-mail e senha.")
        case .offline:
            showOffline = true
        case .error(let message):
            errorMessage = message
        }
    }
}

#Preview {
    NavigationStack {
        SignUpView(email: .constant(""))
            .environmentObject(AuthService())
    }
}
