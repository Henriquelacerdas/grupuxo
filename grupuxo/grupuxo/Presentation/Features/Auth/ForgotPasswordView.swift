import SwiftUI

struct ForgotPasswordView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss
    
    @State var username: String = ""
    @State private var newPassword = ""
    @State private var confirmationCode = ""
    @State private var step: Step = .request
    @State private var message = ""
    
    enum Step {
        case request
        case confirm
        case success
    }
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Redefinir Senha")
                .font(.largeTitle)
                .bold()
            
            if step == .request {
                Text("Digite seu email para receber um código de redefinição.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                
                TextField("Email", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                
                Button("Enviar código") {
                    Task {
                        guard !username.isEmpty else {
                            message = "Digite seu email."
                            return
                        }
                        let success = await authService.resetPassword(username: username)
                        if success {
                            message = ""
                            step = .confirm
                        } else {
                            message = "Erro ao solicitar redefinição. Verifique o email digitado."
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                
            } else if step == .confirm {
                Text("Enviamos um código para seu email.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                
                TextField("Código de confirmação", text: $confirmationCode)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numberPad)
                
                SecureField("Nova senha", text: $newPassword)
                    .textFieldStyle(.roundedBorder)
                
                Button("Redefinir senha") {
                    Task {
                        let success = await authService.confirmResetPassword(username: username, newPassword: newPassword, code: confirmationCode)
                        if success {
                            message = "Senha redefinida com sucesso!"
                            step = .success
                        } else {
                            message = "Código inválido ou senha não atende aos requisitos."
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                
            } else if step == .success {
                Text("Você já pode fazer login com sua nova senha.")
                    .multilineTextAlignment(.center)
                
                Button("Voltar para o Login") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .padding(.top)
            }
            
            if !message.isEmpty {
                Text(message)
                    .foregroundColor(step == .success ? .green : .red)
                    .multilineTextAlignment(.center)
                    .font(.footnote)
            }
            
            Spacer()
        }
        .padding()
        .navigationBarTitleDisplayMode(.inline)
    }
}
