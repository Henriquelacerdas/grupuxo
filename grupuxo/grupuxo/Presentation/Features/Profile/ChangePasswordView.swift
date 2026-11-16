import Combine
import SwiftUI

/// Estado da sheet "Alterar senha". Só valida o que dá para saber sem o Cognito; a senha atual é conferida pelo servidor.
@MainActor
final class ChangePasswordViewModel: ObservableObject {

    @Published var oldPassword = ""
    @Published var newPassword = ""
    @Published var confirmation = ""
    @Published private(set) var message: String?
    @Published private(set) var isWorking = false
    @Published private(set) var didChange = false
    @Published var showsOffline = false

    private let change: (String, String) async -> AuthService.PasswordChangeOutcome

    init(change: @escaping (String, String) async -> AuthService.PasswordChangeOutcome) {
        self.change = change
    }

    var canSave: Bool {
        !oldPassword.isEmpty && !newPassword.isEmpty && !confirmation.isEmpty && !isWorking
    }

    func save() async {
        guard canSave else { return }
        guard newPassword == confirmation else {
            message = String(localized: "As senhas novas não são iguais.")
            return
        }
        message = nil
        isWorking = true
        defer { isWorking = false }
        switch await change(oldPassword, newPassword) {
        case .done: didChange = true
        case .offline: showsOffline = true
        case .wrongPassword: message = String(localized: "A senha atual não confere.")
        case .failed(let text): message = text
        }
    }
}

/// Sheet de Ajustes › Conta › Alterar senha. Só aparece para quem entrou com e-mail e senha.
struct ChangePasswordView: View {

    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: ChangePasswordViewModel

    init(change: @escaping (String, String) async -> AuthService.PasswordChangeOutcome) {
        _viewModel = StateObject(wrappedValue: ChangePasswordViewModel(change: change))
    }

    var body: some View {

        NavigationStack {
            Form {
                Section {
                    SecureField("Senha atual", text: $viewModel.oldPassword)
                        .textContentType(.password)
                }

                Section {
                    SecureField("Senha nova", text: $viewModel.newPassword)
                        .textContentType(.newPassword)
                    SecureField("Repita a senha nova", text: $viewModel.confirmation)
                        .textContentType(.newPassword)
                } footer: {
                    if let message = viewModel.message {
                        Text(message).foregroundStyle(.red)
                    } else {
                        Text(AuthService.passwordRules)
                    }
                }
            }
            .navigationTitle("Alterar senha")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salvar") { Task { await viewModel.save() } }
                        .disabled(!viewModel.canSave)
                }
            }
            .interactiveDismissDisabled(viewModel.isWorking)
            .offlineAlert(isPresented: $viewModel.showsOffline)
            .onChange(of: viewModel.didChange) { _, changed in
                if changed { dismiss() }
            }
        }
    }
}
