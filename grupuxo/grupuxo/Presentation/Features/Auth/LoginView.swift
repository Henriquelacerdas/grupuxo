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
                    .autocorrectionDisabled()
                
                SecureField("Senha", text: $password)
                    .textFieldStyle(.roundedBorder)
                
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
                        case .success:
                            break // App reage ao authService.isSignedIn
                        case .confirmSignUp:
                            showConfirmSignUp = true
                        case .resetPassword:
                            signInError = "Redefinição de senha necessária. Clique em 'Esqueci minha senha'."
                        case .invalidCredentials:
                            signInError = "Email ou senha incorretos."
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
                        ForgotPasswordView(username: username)
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
                        await authService.signInWithApple()
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
                ConfirmSignUpView(email: username)
            }
        }
    }
}
