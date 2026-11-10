import Foundation
import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: AuthService
    @State private var username = ""
    @State private var password = ""
    @State private var signInError = ""
    @State private var showConfirmSignUp = false
    @State private var showOffline = false
    @State private var isWorking = false

    private enum Field { case email, password }
    @FocusState private var focusedField: Field?

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: DesignSystem.Spacing.large) {
                        header
                        Spacer(minLength: 32)
                        form
                    }
                    .padding(.horizontal, AuthLayout.horizontalPadding)
                    .padding(.vertical, DesignSystem.Spacing.small)
                    .frame(minHeight: proxy.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(Color(uiColor: .systemBackground))
            .toolbarVisibility(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $showConfirmSignUp) {
                // Conta criada e nunca confirmada: manda um código novo e, confirmando, já entra.
                ConfirmSignUpView(email: AuthService.normalizedEmail(username), password: password, sendCodeOnAppear: true)
            }
            .offlineAlert(isPresented: $showOffline)
        }
    }

    private var header: some View {
        VStack(spacing: DesignSystem.Spacing.medium) {
            AppLogoView(size: 72)
                .padding(.top, 48)
            Text("Reveza")
                .font(.largeTitle.bold())
            Text("Entre para criar uma casa ou participar de uma que já existe.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var form: some View {
        VStack(spacing: DesignSystem.Spacing.large) {
            VStack(spacing: DesignSystem.Spacing.medium) {
                AuthFieldGroup {
                    TextField("E-mail", text: $username)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focusedField, equals: .email)
                        .onSubmit { focusedField = .password }
                        .authField()
                    AuthFieldDivider()
                    SecureField("Senha", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($focusedField, equals: .password)
                        .onSubmit { Task { await signIn() } }
                        .authField()
                }

                if !signInError.isEmpty {
                    AuthFootnote(text: signInError, isError: true)
                }

                Button {
                    Task { await signIn() }
                } label: {
                    AuthButtonLabel(title: "Entrar com e-mail", isWorking: isWorking)
                }
                .buttonStyle(.authPrimary)
                .disabled(isWorking)

                HStack {
                    NavigationLink("Esqueci a senha") {
                        ForgotPasswordView(username: AuthService.normalizedEmail(username))
                    }
                    Spacer()
                    NavigationLink("Criar conta") {
                        SignUpView(email: $username)
                    }
                }
                .font(.callout)
                .padding(.horizontal, AuthLayout.fieldInset)
            }

            HStack(spacing: DesignSystem.Spacing.medium) {
                VStack { Divider() }
                Text("ou")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                VStack { Divider() }
            }

            Button {
                Task { await signInWithApple() }
            } label: {
                Label("Continuar com a Apple", systemImage: "applelogo")
                    .font(.body.weight(.semibold))
            }
            .buttonStyle(.authApple)
            .disabled(isWorking)

            Text("Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AuthLayout.horizontalPadding)
        }
    }

    private func signIn() async {
        signInError = ""
        focusedField = nil
        isWorking = true
        defer { isWorking = false }
        switch await authService.signIn(username: username, password: password) {
        case .success, .cancelled:
            break // App reage ao authService.isSignedIn
        case .confirmSignUp:
            showConfirmSignUp = true
        case .resetPassword:
            signInError = String(localized: "Redefinição de senha necessária. Toque em Esqueci a senha.")
        case .invalidCredentials:
            signInError = String(localized: "E-mail ou senha incorretos. Tente de novo ou toque em Esqueci a senha.")
        case .offline:
            showOffline = true
        case .error(let msg):
            signInError = msg
        }
    }

    private func signInWithApple() async {
        signInError = ""
        switch await authService.signInWithApple() {
        case .offline:
            showOffline = true
        case .error(let msg):
            signInError = msg
        default:
            break
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthService())
}
