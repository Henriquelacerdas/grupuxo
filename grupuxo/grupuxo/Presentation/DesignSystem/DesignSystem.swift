import SwiftUI

enum DesignSystem {
    /// Escala compartilhada de espaçamento do app, em pontos.
    /// Estes valores são decisões do nosso design, não medidas obrigatórias do HIG.
    enum Spacing {
        static let extraSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
    }

    static let contentSpacing = Spacing.large
    static let minimumTouchTarget: CGFloat = 44
    static let cornerRadius: CGFloat = 12
}

struct EmptyStateView: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage)
    }
}

struct TaskRow: View {
    let item: TaskItem

    var body: some View {
        VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
            Text(item.definition.name).font(.headline)
            if !item.definition.details.isEmpty {
                Text(item.definition.details).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
