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

struct ResidentAvatar: View {
    let user: User

    var body: some View {
        Text(user.name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined())
            .font(.caption.bold())
            .foregroundStyle(.tint)
            .frame(width: 36, height: 36)
            .background(.tint.opacity(0.12), in: Circle())
            .accessibilityHidden(true)
    }
}

struct TaskRow: View {
    let item: TaskItem
    var canComplete = false
    var onComplete: () -> Void = {}

    var body: some View {
        HStack(alignment: .top, spacing: DesignSystem.Spacing.small) {
            Button(action: onComplete) {
                Image(systemName: item.occurrence.isCompleted ? "checkmark.square.fill" : "square")
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.borderless)
            .disabled(!canComplete || item.occurrence.isCompleted)
            .accessibilityLabel("Concluir \(item.definition.name)")
            .accessibilityValue(item.occurrence.isCompleted ? "Concluída" : "Pendente")

            VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                Text(item.definition.name).font(.headline)
                    .strikethrough(item.occurrence.isCompleted)
                if !item.definition.details.isEmpty {
                    Text(item.definition.details).font(.subheadline).foregroundStyle(.secondary)
                }
                if let user = item.assignee {
                    HStack {
                        ResidentAvatar(user: user)
                        Text(user.name).font(.subheadline)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Responsável: \(user.name)")
                } else {
                    Label("Sem responsável", systemImage: "person.crop.circle.badge.questionmark")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                if let dueAt = item.occurrence.dueAt {
                    Text("Prazo: \(dueAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Sem prazo").font(.caption).foregroundStyle(.secondary)
                }
                if item.occurrence.isCompleted {
                    Text("Concluída").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}
