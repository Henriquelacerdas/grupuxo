import Foundation
import SwiftUI

struct ConfirmSignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    @State var email: String
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
        _email = State(initialValue: email)
        self.password = password
        self.sendCodeOnAppear = sendCodeOnAppear
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Verificar Email")
                .font(.largeTitle)
                .bold()

            Text("Enviamos um código de confirmação para o seu e-mail. Se não chegar em alguns minutos, confira o spam ou a pasta de promoções.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(isConfirmed)

            TextField("Código numérico", text: $code)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .disabled(isConfirmed)

            Button {
                Task { await confirm() }
            } label: {
                Group {
                    if isWorking { ProgressView() } else { Text("Confirmar") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isConfirmed || isWorking)

            if !isConfirmed {
                Button("Reenviar código") {
                    Task { await resend() }
                }
                .font(.footnote)
                .disabled(isWorking)
            }

            if !message.isEmpty {
                Text(message)
                    .foregroundColor(isError ? .red : .green)
                    .multilineTextAlignment(.center)
            }

            if isConfirmed {
                Button("Voltar para o Login") {
                    dismiss()
                }
                .padding(.top)
            }
        }
        .padding()
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
