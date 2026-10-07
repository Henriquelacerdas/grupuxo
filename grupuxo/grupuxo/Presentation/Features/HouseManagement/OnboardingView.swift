import SwiftUI
@preconcurrency import Amplify

/// Tela para quem ainda não tem casa: criar uma nova ou entrar por código.
struct OnboardingView: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case create = "Criar casa"
        case join = "Entrar com código"
        var id: Self { self }
    }

    @EnvironmentObject private var houses: HouseService
    @EnvironmentObject private var authService: AuthService

    @State private var mode: Mode = .create
    @State private var myName = ""
    @State private var houseName = ""
    @State private var inviteCode = ""
    @FocusState private var focused: Bool

    private var canSubmit: Bool {
        guard !houses.isLoading, !myName.isBlank else { return false }
        switch mode {
        case .create: return !houseName.isBlank
        case .join: return inviteCode.trimmingCharacters(in: .whitespaces).count >= 6
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "house.and.flag.fill")
                            .font(.system(size: 52))
                            .foregroundStyle(.tint)
                        Text("Bem-vindo!")
                            .font(.title2.bold())
                        Text("Crie a casa e convide os moradores, ou entre em uma casa existente com o código de convite.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    Picker("Opção", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Color.clear)

                Section("Você") {
                    TextField("Seu nome", text: $myName)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                }

                switch mode {
                case .create:
                    Section {
                        TextField("Nome da casa (ex.: Rep. Central)", text: $houseName)
                            .textInputAutocapitalization(.words)
                            .focused($focused)
                    } header: {
                        Text("Nova casa")
                    } footer: {
                        Text("Você será o administrador e receberá um código para convidar os moradores.")
                    }
                case .join:
                    Section {
                        TextField("Código (6 caracteres)", text: $inviteCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                            .focused($focused)
                            .onChange(of: inviteCode) { _, new in
                                inviteCode = String(new.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                            }
                    } header: {
                        Text("Casa existente")
                    } footer: {
                        Text("Peça o código para quem administra a casa.")
                    }
                }

                if let message = houses.errorMessage {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Spacer()
                            if houses.isLoading {
                                ProgressView()
                            } else {
                                Text(mode == .create ? "Criar casa" : "Entrar na casa").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(!canSubmit)
                }
            }
            .navigationTitle("Sua casa")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sair", systemImage: "rectangle.portrait.and.arrow.right") {
                        Task { await authService.signOut() }
                    }
                }
            }
            .onChange(of: mode) { houses.errorMessage = nil }
            .task { await prefillName() }
        }
    }

    private func submit() {
        focused = false
        Task {
            switch mode {
            case .create: await houses.createHouse(name: houseName, myName: myName)
            case .join: await houses.joinHouse(code: inviteCode, myName: myName)
            }
        }
    }

    /// Preenche o nome com o atributo do Cognito (Apple manda "name" só no 1º login).
    private func prefillName() async {
        guard myName.isEmpty,
              let attributes = try? await Amplify.Auth.fetchUserAttributes() else { return }
        let name = attributes.first { $0.key == .name }?.value
            ?? attributes.first { $0.key == .givenName }?.value
            ?? attributes.first { $0.key == .email }?.value.components(separatedBy: "@").first
        if let name, myName.isEmpty { myName = name }
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
