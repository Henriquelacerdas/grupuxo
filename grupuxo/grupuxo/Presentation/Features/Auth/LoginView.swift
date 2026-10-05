import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: AuthService
    @State private var username = ""
    @State private var password = ""
    
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
                
                Button {
                    Task {
                        await authService.signIn(username: username, password: password)
                    }
                } label: {
                    Text("Login")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .padding(.top)
                
                // Botão para ir para a tela de Cadastro
                NavigationLink("Não tem uma conta? Cadastre-se") {
                    SignUpView()
                }
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
        }
    }
}
