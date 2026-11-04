import GrupuxoDomain
import SwiftUI

/// Conta: nome, e-mail e provedor de login (somente leitura: o servidor ainda não tem rota para editar o nome nem
/// guardar foto), sair da conta e apagar a conta.
struct AccountView: View {

    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService

    @ObservedObject var viewModel: AccountViewModel

    @State private var confirmSignOut = false

    var body: some View {

        List {

            if let me = houses.me {
                header(me)
                nameSection(me)
            }

            identitySection

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

        Section {
            Text(me.name)
        } header: {
            Text("Nome").formSectionHeader()
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
