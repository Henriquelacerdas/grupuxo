import SwiftUI
import GrupuxoDomain

/// Cabeçalho de um cômodo em "Repetição do cômodo": nome na cor do cômodo e, abaixo, prazo e progresso.
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

/// Uma tarefa do morador: círculo de conclusão na cor do cômodo, nome e, quando há, cômodo, prazo e troca pedida.
struct MyTaskRow: View {

    let row: MyTasksContent.Row
    let canComplete: Bool
    let onComplete: () -> Void
    /// Tocar no texto da linha abre o detalhe da tarefa.
    let onSelect: () -> Void

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

            Button(action: onSelect) {
                taskText
            }
            .buttonStyle(.plain)
            .accessibilityHint("Abre os detalhes da tarefa")
        }
    }

    private var taskText: some View {

        HStack(spacing: DesignSystem.Spacing.small) {

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

                if let pendingSwap = row.pendingSwap {
                    // Ícone colado ao texto: o `Label` padrão da lista reserva a coluna larga de ícone.
                    Text("\(Image(systemName: "arrow.left.arrow.right")) \(pendingSwap)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            RoomRowChevron()
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var subtitle: some View {

        switch (row.roomName, row.timing) {

        case let (room?, timing?):
            Text("\(room) · \(styled(timing))")

        case let (room?, nil):
            Text(room)

        case let (nil, timing?):
            styled(timing)

        case (nil, nil):
            EmptyView()
        }
    }

    /// "Termina hoje" e "Termina amanhã" em negrito, prazo vencido em vermelho e início futuro sem destaque.
    private func styled(_ timing: TaskTiming) -> Text {
        switch timing.style {
        case .upcoming, .open: Text(timing.text)
        case .due: Text(timing.text).bold()
        case .overdue: Text(timing.text).foregroundStyle(.red)
        }
    }
}
