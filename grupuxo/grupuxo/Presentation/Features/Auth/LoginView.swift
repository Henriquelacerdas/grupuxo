import Foundation
import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: AuthService
    @State private var username = ""
    @State private var password = ""
    @State private var signInError = ""
    @State private var showConfirmSignUp = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Entrar")
                    .font(.largeTitle)
                    .bold()
                
                TextField("Email", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                
                SecureField("Senha", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.password)
                
                if !signInError.isEmpty {
                    Text(signInError)
                        .foregroundColor(.red)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                }
                
                Button {
                    Task {
                        signInError = ""
                        let status = await authService.signIn(username: username, password: password)
                        switch status {
                        case .success, .cancelled:
                            break // App reage ao authService.isSignedIn
                        case .confirmSignUp:
                            showConfirmSignUp = true
                        case .resetPassword:
                            signInError = String(localized: "Redefinição de senha necessária. Clique em 'Esqueci minha senha'.")
                        case .invalidCredentials:
                            signInError = String(localized: "Email ou senha incorretos.")
                        case .error(let msg):
                            signInError = msg
                        }
                    }
                } label: {
                    Text("Login")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .padding(.top)
                
                // Links de cadastro e esqueceu a senha
                HStack {
                    NavigationLink("Cadastre-se") {
                        SignUpView()
                    }
                    
                    Spacer()
                    
                    NavigationLink("Esqueci minha senha") {
                        ForgotPasswordView(username: AuthService.normalizedEmail(username))
                    }
                }
                .font(.callout)
                .padding(.top, 10)
                
                HStack {
        
                    Rectangle().frame(height: 1).foregroundColor(.gray.opacity(0.3))
                    Text("OU").font(.caption).foregroundColor(.gray)
                    Rectangle().frame(height: 1).foregroundColor(.gray.opacity(0.3))
                }
                .padding(.vertical)

                // Botão nativo da Apple
                Button {
                    Task {
                        signInError = ""
                        if case .error(let msg) = await authService.signInWithApple() {
                            signInError = msg
                        }
                    }
                } label: {
                    HStack {
                        Image(systemName: "applelogo")
                        Text("Continuar com a Apple")
                            .bold()
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.black) // Fundo preto característico da Apple
                .foregroundColor(.white)
                .controlSize(.large)
            }
            .padding()
            .navigationDestination(isPresented: $showConfirmSignUp) {
                // Conta criada e nunca confirmada: manda um código novo e, confirmando, já entra.
                ConfirmSignUpView(email: AuthService.normalizedEmail(username), password: password, sendCodeOnAppear: true)
            }
        }
    }
}
