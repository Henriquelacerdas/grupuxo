import Foundation
import SwiftUI

struct SignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    @State private var email = ""
    @State private var password = ""

    @State private var showConfirmation = false
    @State private var errorMessage = ""
    @State private var isWorking = false

    var body: some View {
        VStack(spacing: 20) {
            Text("Criar Conta")
                .font(.largeTitle)
                .bold()

            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .textContentType(.username)
                .autocorrectionDisabled()

            SecureField("Senha", text: $password)
                .textFieldStyle(.roundedBorder)
                .textContentType(.newPassword)

            Text(AuthService.passwordRules)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await signUp() }
            } label: {
                Group {
                    if isWorking { ProgressView() } else { Text("Cadastrar") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
            .padding(.top)
        }
        .padding()
        .sheet(isPresented: $showConfirmation, onDismiss: {
            // Já logado (confirmou e entrou): o app troca de tela sozinho.
            if !authService.isSignedIn { dismiss() }
        }) {
            ConfirmSignUpView(email: AuthService.normalizedEmail(email), password: password)
        }
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
            errorMessage = String(localized: "Já existe uma conta com este e-mail. Volte e entre com sua senha, ou use \"Esqueci minha senha\".")
        case .resetPassword:
            errorMessage = String(localized: "Redefinição de senha necessária. Volte e toque em \"Esqueci minha senha\".")
        case .invalidCredentials:
            errorMessage = String(localized: "Conta criada. Volte e entre com seu e-mail e senha.")
        case .error(let message):
            errorMessage = message
        }
    }
}
