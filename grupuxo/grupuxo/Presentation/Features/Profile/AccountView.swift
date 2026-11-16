import GrupuxoDomain
import SwiftUI

/// Conta: nome (editável), e-mail e provedor de login (somente leitura), alterar senha, sair da conta e apagar a conta.
struct AccountView: View {

    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService

    @ObservedObject var viewModel: AccountViewModel

    @State private var confirmSignOut = false
    @State private var changesPassword = false

    var body: some View {

        List {

            if let me = houses.me {
                header(me)
                ProfilePhotoSection()
                nameSection(me)
            }
            if let message = houses.errorMessage {
                Section { Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }

            identitySection

            passwordSection

            Section {
                Button("Sair da conta") { confirmSignOut = true }
                    .frame(maxWidth: .infinity)
            }

            Section {
                DeleteAccountButton(title: "Apagar conta", systemImage: nil)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(
                        Color.red.opacity(DesignSystem.destructiveFillOpacity)
                    )
            } footer: {
                Text("Apaga seu perfil e o vínculo com o WhatsApp e tira você da casa. Não dá para desfazer.")
            }
        }
        .navigationTitle("Conta")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .confirmationDialog("Sair da conta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sair da conta", role: .destructive) { Task { await authService.signOut() } }
        }
        .sheet(isPresented: $changesPassword) {
            ChangePasswordView { old, new in
                await authService.changePassword(oldPassword: old, newPassword: new)
            }
        }
    }

    /// Conta de e-mail e senha troca a senha aqui; quem entrou com a Apple não tem senha no Reveza.
    @ViewBuilder
    private var passwordSection: some View {

        if viewModel.identity?.provider == .password {
            Section {
                Button("Alterar senha") { changesPassword = true }
            }
        }
    }

    // MARK: - Seções

    private func header(_ me: User) -> some View {

        Section {
            ResidentAvatar(user: me, size: .hero)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        }
    }

    private func nameSection(_ me: User) -> some View {

        EditableNameSection(
            header: "Nome",
            placeholder: "Seu nome",
            currentName: me.name,
            emptyMessage: String(localized: "Informe um nome válido.")
        ) { name in
            await houses.updateMyName(to: name)
        }
    }

    @ViewBuilder
    private var identitySection: some View {

        if let identity = viewModel.identity, identity.email != nil || identity.provider != nil {

            Section {

                if let email = identity.email {
                    LabeledContent("E-mail") {
                        Text(email)
                    }
                }

                if let provider = identity.provider {
                    LabeledContent("Entrou com") {
                        providerName(provider)
                    }
                }
            }
        }
    }

    private func providerName(_ provider: AccountIdentity.Provider) -> Text {

        switch provider {
        case .apple: Text("Apple")
        case .password: Text("E-mail e senha")
        }
    }
}
