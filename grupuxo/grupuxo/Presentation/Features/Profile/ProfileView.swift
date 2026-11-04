import GrupuxoDomain
import SwiftUI

/// Ajustes (o perfil): cartão da conta, casa e convite, notificações e WhatsApp, ajuda e sobre.
/// Abre em sheet com botão de fechar; Conta, Casa, Notificações e WhatsApp são telas empurradas dentro dela.
struct ProfileView: View {

    enum Destination: Hashable {
        case account
        case house
        case notifications
        case whatsApp
    }

    @EnvironmentObject private var houses: RemoteHouseSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @StateObject private var whatsApp: WhatsAppConnectionViewModel
    @StateObject private var account: AccountViewModel

    private let appInfo: AppInfo

    init(
        whatsAppViewModel: WhatsAppConnectionViewModel,
        accountViewModel: AccountViewModel,
        appInfo: AppInfo
    ) {
        _whatsApp = StateObject(wrappedValue: whatsAppViewModel)
        _account = StateObject(wrappedValue: accountViewModel)
        self.appInfo = appInfo
    }

    var body: some View {

        NavigationStack {

            List {

                if let me = houses.me {
                    profileCard(me)
                }

                if let house = houses.house {
                    houseSection(house)
                }

                youSection

                if appInfo.hasHelpLinks {
                    helpSection
                }

                aboutSection
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .accessibilityIdentifier("closeSettings")
                }
            }
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .account: AccountView(viewModel: account)
                case .house: HouseSettingsView()
                case .notifications: NotificationSettingsView()
                case .whatsApp: WhatsAppSettingsView(viewModel: whatsApp)
                }
            }
            .refreshable { await houses.refresh() }
            .task { await whatsApp.load() }
        }
    }

    // MARK: - Seções

    private func profileCard(_ me: User) -> some View {

        Section {
            NavigationLink(value: Destination.account) {

                HStack(spacing: DesignSystem.Spacing.large) {

                    ResidentAvatar(user: me, size: .profile)

                    VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                        Text(me.name)
                            .font(.title3.bold())
                        Text("Sua conta")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("profileAccount")
        }
    }

    private func houseSection(_ house: House) -> some View {

        Section {

            NavigationLink(value: Destination.house) {
                SettingsRowLabel(
                    title: Text(house.name),
                    systemImage: "house.fill",
                    tint: .orange,
                    value: Text("\(houses.members.count) pessoas")
                )
            }

            HStack(spacing: DesignSystem.Spacing.medium) {

                SettingsIcon(systemName: "person.badge.key.fill", tint: .blue)

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                    Text("Código para convidar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(house.accessCode)
                        .font(.title3.monospaced().bold())
                        .tracking(DesignSystem.inviteCodeTracking)
                        .textSelection(.enabled)
                }

                Spacer(minLength: DesignSystem.Spacing.small)

                CopyCodeButton(code: house.accessCode)
            }
        } header: {
            Text("Casa").settingsSectionHeader()
        }
    }

    private var youSection: some View {

        Section {

            NavigationLink(value: Destination.notifications) {
                SettingsRowLabel(
                    title: Text("Notificações"),
                    systemImage: "bell.fill",
                    tint: .red
                )
            }

            NavigationLink(value: Destination.whatsApp) {
                SettingsRowLabel(
                    title: Text("WhatsApp"),
                    systemImage: "paperplane.fill",
                    tint: .green,
                    value: whatsAppStatus
                )
            }
        } header: {
            Text("Você").settingsSectionHeader()
        }
    }

    private var helpSection: some View {

        Section {

            if let url = appInfo.helpURL {
                linkRow(Text("Como o Reveza funciona"), systemImage: "info.circle.fill", tint: .gray, url: url)
            }

            if let url = appInfo.feedbackURL {
                linkRow(Text("Enviar sugestão"), systemImage: "star.fill", tint: .purple, url: url)
            }
        } header: {
            Text("Ajuda").settingsSectionHeader()
        }
    }

    private var aboutSection: some View {

        Section {

            if let url = appInfo.privacyPolicyURL {
                linkRow(Text("Política de Privacidade"), url: url)
            }

            if let url = appInfo.termsOfUseURL {
                linkRow(Text("Termos de Uso"), url: url)
            }

            if let version = appInfo.version {
                SettingsRowLabel(title: Text("Versão"), value: Text(version))
            }
        } header: {
            Text("Sobre").settingsSectionHeader()
        }
    }

    private func linkRow(_ title: Text, systemImage: String? = nil, tint: Color = .accentColor, url: URL) -> some View {

        Button {
            openURL(url)
        } label: {
            SettingsRowLabel(title: title, systemImage: systemImage, tint: tint, showsDisclosure: true)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }

    /// O estado só aparece quando já se sabe; carregando ou com erro a linha fica sem valor.
    private var whatsAppStatus: Text? {

        switch whatsApp.state {
        case .connected: Text("Conectado")
        case .notConnected: Text("Não conectado")
        case .idle, .loading, .failed: nil
        }
    }
}
