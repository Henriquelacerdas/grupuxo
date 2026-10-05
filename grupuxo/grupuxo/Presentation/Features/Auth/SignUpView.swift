import SwiftUI

struct SignUpView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss
    
    // Deixamos apenas Email e Senha
    @State private var email = ""
    @State private var password = ""
    
    @State private var showConfirmation = false
    @State private var errorMessage = ""
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Criar Conta")
                .font(.largeTitle)
                .bold()
            
            // Campo de Email
            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
            
            // Campo de Senha
            SecureField("Senha", text: $password)
                .textFieldStyle(.roundedBorder)
            
            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            }
            
            Button {
                Task {
                    errorMessage = ""
                    
                    // O SEGREDO ESTÁ AQUI: Passamos o 'email' tanto no campo username quanto no email
                    let success = await authService.signUp(username: email, email: email, password: password)
                    
                    if success {
                        showConfirmation = true
                    } else {
                        errorMessage = "Falha no cadastro. Verifique a força da senha."
                    }
                }
            } label: {
                Text("Cadastrar")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.top)
        }
        .padding()
        .sheet(isPresented: $showConfirmation, onDismiss: {
            dismiss()
        }) {
            // Passamos o email capturado para a tela de confirmação
            ConfirmSignUpView(email: email)
        }
    }
}
