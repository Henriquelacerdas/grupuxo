import SwiftUI

/// Apresentação do Reveza, mostrada só na primeira abertura, antes do login.
struct WelcomeView: View {
    let onContinue: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 48) {
                Text("Boas-vindas ao Reveza")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                    .padding(.top, 56)

                VStack(alignment: .leading, spacing: 28) {
                    WelcomeFeature(
                        systemImage: "repeat",
                        tint: .orange,
                        title: "Cada cômodo tem a sua vez",
                        detail: "A cada ciclo, cada cômodo passa para outra pessoa, como na lousa da república."
                    )
                    WelcomeFeature(
                        systemImage: "bolt",
                        tint: .purple,
                        title: "Divisão justa",
                        detail: "As tarefas são divididas pelo esforço de cada uma. Ninguém fica sempre com a parte pesada."
                    )
                    WelcomeFeature(
                        systemImage: "clock",
                        tint: .blue,
                        title: "Ninguém precisa cobrar ninguém",
                        detail: "Lembretes na hora certa, e todo mundo vê o que já foi feito."
                    )
                }
            }
            .padding(.horizontal, 32)
        }
        .safeAreaInset(edge: .bottom) {
            Button("Continuar", action: onContinue)
                .buttonStyle(.authPrimary)
                .padding(.horizontal, AuthLayout.horizontalPadding)
                .padding(.vertical, DesignSystem.Spacing.small)
                .background(Color(uiColor: .systemBackground))
        }
        .background(Color(uiColor: .systemBackground))
    }
}

private struct WelcomeFeature: View {
    let systemImage: String
    let tint: Color
    let title: LocalizedStringKey
    let detail: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: DesignSystem.Spacing.large) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(tint)
                .frame(width: 36)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    WelcomeView {}
}
