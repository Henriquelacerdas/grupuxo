import SwiftUI

/// Peças visuais das telas de entrada (Figma "Boas-vindas e entrada").
enum AuthLayout {
    static let horizontalPadding: CGFloat = 20
    static let fieldGroupCornerRadius: CGFloat = 16
    static let fieldInset: CGFloat = 14
    static let buttonHeight: CGFloat = 50
}

/// Botão cápsula de largura total. Desabilitado fica cinza, como no design.
struct AuthCapsuleButtonStyle: ButtonStyle {
    var fill: Color = .accentColor
    var foreground: Color = .white

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: AuthLayout.buttonHeight)
            .foregroundStyle(isEnabled ? foreground : Color.secondary)
            .background(isEnabled ? fill : Color(uiColor: .systemGray5), in: .capsule)
            .contentShape(.capsule)
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

extension ButtonStyle where Self == AuthCapsuleButtonStyle {
    static var authPrimary: AuthCapsuleButtonStyle { AuthCapsuleButtonStyle() }
    /// "Continuar com a Apple": preto no claro, branco no escuro (HIG).
    static var authApple: AuthCapsuleButtonStyle {
        AuthCapsuleButtonStyle(fill: .primary, foreground: Color(uiColor: .systemBackground))
    }
}

/// Rótulo do botão principal: troca o texto por um indicador enquanto a chamada roda.
struct AuthButtonLabel: View {
    let title: LocalizedStringKey
    let isWorking: Bool

    var body: some View {
        if isWorking {
            ProgressView()
        } else {
            Text(title)
        }
    }
}

/// Fundo cinza arredondado que agrupa os campos (E-mail / Senha), com divisor entre eles.
struct AuthFieldGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Color(uiColor: .secondarySystemFill), in: .rect(cornerRadius: AuthLayout.fieldGroupCornerRadius))
    }
}

struct AuthFieldDivider: View {
    var body: some View {
        Divider().padding(.horizontal, AuthLayout.fieldInset)
    }
}

extension View {
    /// Campo dentro de `AuthFieldGroup`.
    func authField() -> some View {
        padding(.horizontal, AuthLayout.fieldInset)
            .frame(minHeight: AuthLayout.buttonHeight)
    }

    /// Alerta "Sem conexão" das telas de entrada.
    func offlineAlert(isPresented: Binding<Bool>) -> some View {
        alert("Sem conexão", isPresented: isPresented) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Confira o Wi-Fi ou os dados móveis e tente de novo.")
        }
    }
}

/// Título grande à esquerda com o texto de apoio embaixo.
struct AuthHeader: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {
            Text(title)
                .font(.title.bold())
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "Confira seu e-mail": check verde e o endereço para onde o código foi.
struct AuthCheckEmailHeader: View {
    let email: String

    var body: some View {
        VStack(spacing: DesignSystem.Spacing.medium) {
            Image(systemName: "checkmark")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 68, height: 68)
                .background(Color.green, in: .circle)
                .padding(.bottom, DesignSystem.Spacing.small)
                .accessibilityHidden(true)
            Text("Confira seu e-mail")
                .font(.title2.bold())
            Text("Mandamos um código para \(email). Se não chegar, olhe o spam.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 72)
    }
}

/// Campo do código de 6 dígitos que chega por e-mail.
struct AuthCodeField: View {
    @Binding var code: String

    var body: some View {
        AuthFieldGroup {
            TextField("Código", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .multilineTextAlignment(.center)
                .font(.title3.monospacedDigit())
                .authField()
        }
    }
}

/// Texto curto abaixo dos campos: dica (cinza) ou erro (vermelho).
struct AuthFootnote: View {
    let text: String
    var isError = false

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(isError ? Color.red : Color.secondary)
            .padding(.horizontal, AuthLayout.fieldInset)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Ícone do app. `AppLogo` é exportado do `AppIcon.icon` (já com cantos e vidro) pelo `ictool` do Xcode;
/// mudou o ícone, exporte de novo (claro e escuro).
struct AppLogoView: View {
    var size: CGFloat = 64

    var body: some View {
        Image("AppLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
            .accessibilityHidden(true)
    }
}

/// Esqueleto das telas internas: conteúdo rolável no topo e ações presas ao rodapé (sobem com o teclado).
struct AuthScreen<Content: View, Footer: View>: View {
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        ScrollView {
            VStack(spacing: DesignSystem.Spacing.large) {
                content
            }
            .padding(.horizontal, AuthLayout.horizontalPadding)
            .padding(.top, DesignSystem.Spacing.small)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: DesignSystem.Spacing.large) {
                footer
            }
            .padding(.horizontal, AuthLayout.horizontalPadding)
            .padding(.bottom, DesignSystem.Spacing.small)
            .padding(.top, DesignSystem.Spacing.small)
            .background(Color(uiColor: .systemBackground))
        }
        .background(Color(uiColor: .systemBackground))
        .navigationBarTitleDisplayMode(.inline)
    }
}
