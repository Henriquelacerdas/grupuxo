import SwiftUI

enum DesignSystem {
    static let contentSpacing: CGFloat = 16
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
        VStack(alignment: .leading, spacing: 4) {
            Text(item.definition.name).font(.headline)
            if !item.definition.details.isEmpty {
                Text(item.definition.details).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
