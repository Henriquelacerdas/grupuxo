import SwiftUI
import GrupuxoDomain

/// Cabeçalho de um cômodo em "Seu ciclo": nome na cor do cômodo e, abaixo, prazo e progresso.
struct CycleRoomHeader: View {

    let cycle: MyTasksContent.Cycle

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.extraSmall
        ) {

            Text(cycle.roomName)
                .font(.title3.weight(.semibold))
                .foregroundStyle(cycle.color.tint)

            Text(cycle.status)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, DesignSystem.Spacing.small)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cycle.roomName)
        .accessibilityValue(cycle.spokenStatus)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Uma tarefa do morador: círculo de conclusão na cor do cômodo, nome e, quando há, cômodo e dia do prazo.
struct MyTaskRow: View {

    let row: MyTasksContent.Row
    let canComplete: Bool
    let onComplete: () -> Void

    private var item: TaskItem { row.item }

    private var isCompleted: Bool { item.occurrence.isCompleted }

    var body: some View {

        HStack(spacing: DesignSystem.Spacing.small) {

            Button {
                Haptics.completionToggled(wasCompleted: isCompleted)
                onComplete()
            } label: {

                Image(systemName: isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(row.color.tint)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(
                        minWidth: DesignSystem.minimumTouchTarget,
                        minHeight: DesignSystem.minimumTouchTarget,
                        alignment: .leading
                    )
            }
            .buttonStyle(.plain)
            .disabled(!canComplete)
            .accessibilityLabel(
                isCompleted
                    ? "Desmarcar conclusão de \(item.definition.name)"
                    : "Concluir \(item.definition.name)"
            )
            .accessibilityValue(isCompleted ? "Concluída" : "Pendente")

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.extraSmall
            ) {

                Text(item.definition.name)
                    .font(.body)
                    .strikethrough(isCompleted)
                    .foregroundStyle(isCompleted ? .secondary : .primary)

                subtitle
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var subtitle: some View {

        switch (row.roomName, row.dueDay) {

        case let (room?, day?):
            Text("\(room) · \(Text(day).bold())")

        case let (room?, nil):
            Text(room)

        case let (nil, day?):
            Text(day).bold()

        case (nil, nil):
            EmptyView()
        }
    }
}
