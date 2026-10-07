import SwiftUI

struct ConfirmSignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss
    
    // Variável agora é um @State para podermos ver e editar na tela
    @State var email: String
    
    @State private var code = ""
    @State private var message = ""
    @State private var isConfirmed = false
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Verificar Email")
                .font(.largeTitle)
                .bold()
            
            Text("Enviamos um código de confirmação para você.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
            
            // Mostramos o email na tela para garantir que não está vazio
            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .disabled(isConfirmed) // Desabilita se já confirmou
            
            TextField("Código numérico", text: $code)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .disabled(isConfirmed)
            
            Button {
                Task {
                    // Trava de segurança: impede envio de email vazio
                    guard !email.isEmpty else {
                        message = "O email não pode estar vazio."
                        return
                    }
                    
                    let success = await authService.confirmSignUp(username: email, code: code)
                    if success {
                        message = "Conta confirmada! Você já pode fazer login."
                        isConfirmed = true
                    } else {
                        message = "Código inválido. Tente novamente."
                    }
                }
            } label: {
                Text("Confirmar")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isConfirmed)
            
            if !isConfirmed {
                Button("Reenviar código") {
                    Task {
                        let success = await authService.resendSignUpCode(username: email)
                        message = success ? "Código reenviado!" : "Erro ao reenviar código."
                    }
                }
                .font(.footnote)
            }
            
            if !message.isEmpty {
                Text(message)
                    .foregroundColor(isConfirmed ? .green : .red)
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
    }
}
