import SwiftUI
import GrupuxoDomain

/// Aba "Todas": tarefa de repetição própria, com a repetição e o esforço ("A cada 2 semanas · Médio").
struct RoomGeneralTaskRow: View {

    let item: TaskItem
    let onSelect: () -> Void

    var body: some View {

        Button(action: onSelect) {

            HStack(spacing: DesignSystem.Spacing.small) {

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                    Text(item.definition.name)
                        .font(.body)
                        .foregroundStyle(.primary)

                    HStack(spacing: DesignSystem.Spacing.extraSmall) {
                        Image(systemName: "repeat")
                            .accessibilityLabel("Repetição própria")
                        Text(RoomDetailText.subtitle(for: item.definition, includingRecurrence: true))
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                Spacer(minLength: DesignSystem.Spacing.small)

                RoomRowChevron()
            }
            .roomTaskRowFrame()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre os detalhes da tarefa")
    }
}

/// Aba "Todas": tarefa da repetição do cômodo, só com o esforço (quem faz muda a cada rodízio).
struct RoomCycleAllTaskRow: View {

    let item: TaskItem
    let onSelect: () -> Void

    var body: some View {

        Button(action: onSelect) {

            HStack(spacing: DesignSystem.Spacing.small) {

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                    Text(item.definition.name)
                        .font(.body)
                        .foregroundStyle(.primary)

                    Text(RoomDetailText.effort(item.definition.effort))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: DesignSystem.Spacing.small)

                RoomRowChevron()
            }
            .roomTaskRowFrame()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre os detalhes da tarefa")
    }
}

/// Tarefa única do cômodo: bandeira, nome, de quem é e, se ninguém pegou, o botão "Pegar".
struct RoomUniqueTaskRow: View {

    let item: TaskItem
    let currentUserID: User.ID
    let onSelect: () -> Void
    var onClaim: (() -> Void)? = nil

    private var isOpen: Bool {
        item.assignment == nil && !item.occurrence.isCompleted
    }

    var body: some View {

        HStack(spacing: DesignSystem.Spacing.small) {

            Button(action: onSelect) {

                HStack(spacing: DesignSystem.Spacing.medium) {

                    Image(systemName: "flag.fill")
                        .font(.title3)
                        .foregroundStyle(.red)
                        .frame(minWidth: DesignSystem.minimumTouchTarget)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                        Text(item.definition.name)
                            .font(.body)
                            .foregroundStyle(.primary)

                        Text(RoomDetailText.singleTaskStatus(item, currentUserID: currentUserID))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Abre os detalhes da tarefa")

            if isOpen {
                Button("Pegar") { onClaim?() }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .disabled(onClaim == nil)
                    .accessibilityHint("Assume esta tarefa")
            } else {
                RoomRowChevron()
            }
        }
        .roomTaskRowFrame()
    }
}
