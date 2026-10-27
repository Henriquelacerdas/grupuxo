import SwiftUI

/// Título de seção que recolhe e expande o conteúdo abaixo dele.
struct CollapsibleSectionHeader: View {

    let title: String
    let isExpanded: Bool
    let action: () -> Void

    var body: some View {

        Button(action: action) {

            HStack(spacing: DesignSystem.Spacing.small) {

                Text(title)
                    .font(.title2.bold())
                    .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.down")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(isExpanded ? 0 : -90))
            }
            .frame(minHeight: DesignSystem.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(isExpanded ? "Expandida" : "Recolhida")
        .accessibilityHint(isExpanded ? "Recolhe a seção" : "Expande a seção")
    }
}
