import SwiftUI

/// Convite à avaliação anônima da semana. As ações ainda não fazem nada: ficam para quando a avaliação existir.
struct WeeklySummaryCard: View {

    let message: String
    let onLater: () -> Void
    let onRate: () -> Void

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.medium
        ) {

            Label {
                Text("Resumo da semana")
                    .font(.headline)
            } icon: {
                Image(systemName: "star.fill")
                    .foregroundStyle(.tint)
            }

            Text(message)
                .font(.body)

            // Em tamanhos de acessibilidade os botões não cabem lado a lado.
            ViewThatFits(in: .horizontal) {

                HStack(spacing: DesignSystem.Spacing.small) {
                    buttons
                }

                VStack(spacing: DesignSystem.Spacing.small) {
                    buttons
                }
            }
        }
        .padding(DesignSystem.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground(Color(uiColor: .secondarySystemBackground))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("weeklySummaryCard")
    }

    @ViewBuilder
    private var buttons: some View {

        Button(action: onLater) {
            Text("Depois")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.large)

        Button(action: onRate) {
            Text("Avaliar")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
    }
}
