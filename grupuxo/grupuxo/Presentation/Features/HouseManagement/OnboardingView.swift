import SwiftUI
@preconcurrency import Amplify
import GrupuxoDomain

/// Primeiros passos de quem ainda não tem casa: seu nome → entrar com código ou criar a casa → (criou) convidar.
/// Com `isFinishing` verdadeiro, o `HouseGateView` continua mostrando esta tela depois de a casa existir, para o
/// passo "Convidar"; ao terminar, o app abre na aba Casa.
struct OnboardingView: View {

    private enum Step: Hashable {
        case house
        case join
        case houseName
        case invite
    }

    /// O código de convite tem 6 letras ou números (BACKEND.md §6.1).
    private static let inviteCodeLength = 6

    @Binding var isFinishing: Bool

    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService

    @State private var path: [Step] = []
    @State private var myName = ""
    @State private var houseName = ""
    @State private var inviteCode = ""
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack(path: $path) {
            profileStep
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .house: houseStep
                    case .join: joinStep
                    case .houseName: houseNameStep
                    case .invite: inviteStep
                    }
                }
        }
        .confirmationDialog("Sair da conta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sair da conta", role: .destructive) { Task { await authService.signOut() } }
        }
        .onChange(of: path) { houses.errorMessage = nil }
        .task { await prefillName() }
    }

    // MARK: - Seu perfil

    private var profileStep: some View {
        OnboardingStepScreen {
            Section {
                OnboardingHeader(
                    title: "Como a casa vai te chamar?",
                    subtitle: "Seu nome aparece nas tarefas e no rodízio."
                )
                InitialAvatar(name: myName)
                    .frame(maxWidth: .infinity)
                    .padding(.top, DesignSystem.Spacing.large)
            }
            .onboardingHeaderRow()

            Section {
                TextField("Seu nome", text: $myName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.continue)
                    .onSubmit { if !myName.isBlank { path.append(.house) } }
            } footer: {
                Text("Se você entrou com a Apple, o nome já vem preenchido.")
            }

            Section {
                DeleteAccountButton(systemImage: nil)
            }
        } footer: {
            Button("Continuar") { path.append(.house) }
                .buttonStyle(.authPrimary)
                .disabled(myName.isBlank)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Sair da conta", systemImage: "rectangle.portrait.and.arrow.right") {
                    confirmSignOut = true
                }
            }
        }
    }

    // MARK: - Sua casa

    private var houseStep: some View {
        OnboardingStepScreen {
            Section {
                OnboardingHeader(
                    title: "Você já tem uma casa no Reveza?",
                    subtitle: "Se alguém da sua casa já usa o app, peça o código para entrar."
                )
            }
            .onboardingHeaderRow()

            Section {
                choiceRow(
                    title: "Entrar com código",
                    subtitle: "Alguém da casa já te mandou o código.",
                    step: .join
                )
                choiceRow(
                    title: "Criar uma casa",
                    subtitle: "Monte os cômodos e chame a casa.",
                    step: .houseName
                )
            }
        } footer: {
            EmptyView()
        }
    }

    private func choiceRow(title: LocalizedStringKey, subtitle: LocalizedStringKey, step: Step) -> some View {
        NavigationLink(value: step) {
            VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                Text(title)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, DesignSystem.Spacing.extraSmall)
        }
    }

    // MARK: - Entrar com código

    private var joinStep: some View {
        OnboardingStepScreen {
            Section {
                OnboardingHeader(
                    title: "Qual é o código da casa?",
                    subtitle: "Peça para quem criou a casa. Ele aparece em Ajustes, na seção Casa."
                )
            }
            .onboardingHeaderRow()

            Section {
                TextField("Código de 6 letras", text: $inviteCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .submitLabel(.join)
                    .onSubmit(join)
                    .onChange(of: inviteCode) { _, new in
                        inviteCode = String(new.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(Self.inviteCodeLength))
                        houses.errorMessage = nil
                    }
            } footer: {
                if let message = houses.errorMessage {
                    Text(message).foregroundStyle(.red)
                }
            }
        } footer: {
            Button(action: join) {
                AuthButtonLabel(title: "Entrar na casa", isWorking: houses.isLoading)
            }
            .buttonStyle(.authPrimary)
            .disabled(houses.isLoading || inviteCode.count < Self.inviteCodeLength)
        }
    }

    private func join() {
        guard !houses.isLoading, inviteCode.count == Self.inviteCodeLength else { return }
        Task {
            await houses.joinHouse(code: inviteCode, myName: myName)
            if houses.house != nil { finish() }
        }
    }

    // MARK: - Nome da casa

    private var houseNameStep: some View {
        OnboardingStepScreen {
            Section {
                OnboardingHeader(
                    title: "Como se chama a casa?",
                    subtitle: "Todo mundo que entrar vai ver esse nome."
                )
            }
            .onboardingHeaderRow()

            Section {
                TextField("Nome da casa", text: $houseName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.continue)
                    .onSubmit(create)
            } footer: {
                if let message = houses.errorMessage {
                    Text(message).foregroundStyle(.red)
                } else {
                    Text("Ex.: Rep da Unicamp, Apê da Augusta.")
                }
            }
        } footer: {
            Button(action: create) {
                AuthButtonLabel(title: "Continuar", isWorking: houses.isLoading)
            }
            .buttonStyle(.authPrimary)
            .disabled(houses.isLoading || houseName.isBlank)
        }
    }

    private func create() {
        guard !houses.isLoading, !houseName.isBlank, !myName.isBlank else { return }
        // Mantém esta tela à frente do app até o passo "Convidar" terminar.
        isFinishing = true
        Task {
            await houses.createHouse(name: houseName, myName: myName)
            if houses.house != nil {
                path.append(.invite)
            } else {
                isFinishing = false
            }
        }
    }

    // MARK: - Convidar

    private var inviteStep: some View {
        OnboardingStepScreen {
            Section {
                OnboardingHeader(
                    title: "Chame quem mora com você",
                    subtitle: inviteSubtitle
                )
            }
            .onboardingHeaderRow()

            if let code = houses.inviteCode {
                Section {
                    VStack(spacing: DesignSystem.Spacing.small) {
                        Text(code)
                            .font(.largeTitle.monospaced().bold())
                            .tracking(DesignSystem.Spacing.small)
                            .textSelection(.enabled)
                        Text("Código da casa")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignSystem.Spacing.large)
                    .accessibilityElement(children: .combine)
                }
            }
        } footer: {
            if let code = houses.inviteCode {
                ShareLink(item: inviteMessage(code: code)) {
                    Text("Compartilhar convite")
                }
                .buttonStyle(.authPrimary)

                Button("Copiar código") {
                    UIPasteboard.general.string = code
                    Haptics.success()
                }
                .buttonStyle(AuthCapsuleButtonStyle(
                    fill: Color.accentColor.opacity(DesignSystem.tintedFillOpacity),
                    foreground: .accentColor
                ))
            }

            Button("Fazer isso depois", action: finish)
                .frame(minHeight: DesignSystem.minimumTouchTarget)
        }
        .navigationBarBackButtonHidden()
    }

    private var inviteSubtitle: LocalizedStringKey {
        if let name = houses.house?.name {
            "Quem entrar com este código participa do rodízio da \(name)."
        } else {
            "Quem entrar com este código participa do rodízio da casa."
        }
    }

    private func inviteMessage(code: String) -> String {
        String(localized: "Entre na casa \(houses.house?.name ?? "") no Reveza com o código \(code).")
    }

    /// Fecha o onboarding e abre o app na aba Casa.
    private func finish() {
        ShortcutNavigationManager.shared.navigate(to: .house)
        isFinishing = false
    }

    /// Preenche o nome com o atributo do Cognito (Apple manda "name" só no 1º login e o
    /// morador pode ocultá-lo). Nunca deixa o campo vazio: sem nome, usa o início do
    /// e-mail (exceto o relay privado da Apple, cujo prefixo é aleatório) e, por fim, "Morador".
    private func prefillName() async {
        guard myName.isEmpty else { return }
        let attributes = (try? await Amplify.Auth.fetchUserAttributes()) ?? []
        func value(_ key: AuthUserAttributeKey) -> String? {
            attributes.first { $0.key == key }?.value
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
        }
        let emailPrefix: String? = value(.email).flatMap { email in
            guard !email.lowercased().hasSuffix("@privaterelay.appleid.com") else { return nil }
            return email.components(separatedBy: "@").first?.nilIfEmpty
        }
        let name = value(.name) ?? value(.givenName) ?? emailPrefix ?? String(localized: "Morador")
        if myName.isEmpty { myName = name }
    }
}

// MARK: - Peças

/// Esqueleto de cada passo: lista agrupada rolável e as ações presas ao rodapé (sobem com o teclado).
private struct OnboardingStepScreen<Content: View, Footer: View>: View {
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        Form {
            content
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: DesignSystem.Spacing.medium) {
                footer
            }
            .padding(.horizontal, AuthLayout.horizontalPadding)
            .padding(.vertical, DesignSystem.Spacing.small)
            .background(Color(uiColor: .systemGroupedBackground))
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Título grande à esquerda com o texto de apoio, no topo da lista.
private struct OnboardingHeader: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey

    var body: some View {
        AuthHeader(title: title, subtitle: subtitle)
    }
}

/// Círculo com as iniciais do nome digitado (o mesmo visual do `ResidentAvatar` grande).
private struct InitialAvatar: View {
    let name: String

    @ScaledMetric(relativeTo: .largeTitle) private var diameter: CGFloat = 96

    var body: some View {
        Text(name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined())
            .font(.largeTitle.bold())
            .foregroundStyle(.tint)
            .frame(width: diameter, height: diameter)
            .background(Color.accentColor.opacity(DesignSystem.tintedFillOpacity), in: Circle())
            .accessibilityHidden(true)
    }
}

private extension View {
    /// Linha do cabeçalho sem fundo de célula, alinhada com as seções.
    func onboardingHeaderRow() -> some View {
        listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .listSectionSpacing(.compact)
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
