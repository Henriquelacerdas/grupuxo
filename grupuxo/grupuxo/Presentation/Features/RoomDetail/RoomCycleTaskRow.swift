import SwiftUI
import GrupuxoDomain

/// Linha da aba "Agora" do cômodo: avatar de quem está com a vez, nome da tarefa e "Para você",
/// "Para Henrique L." ou "Feita por você"; nas de repetição própria, também o prazo.
struct RoomCycleTaskRow: View {

    let item: TaskItem
    let currentUserID: User.ID
    /// "Termina sexta", "Começa sábado"; só nas de repetição própria.
    var timing: String? = nil
    let onSelect: () -> Void

    private var isCompleted: Bool { item.occurrence.isCompleted }

    private var person: User? { item.assignee ?? item.suggestedAssignee }

    var body: some View {

        Button(action: onSelect) {

            HStack(spacing: DesignSystem.Spacing.medium) {

                avatar

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                    Text(item.definition.name)
                        .font(.body)
                        .foregroundStyle(.primary)

                    statusLine
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: DesignSystem.Spacing.extraSmall)

                RoomRowChevron()
            }
            .roomTaskRowFrame()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre os detalhes da tarefa")
    }

    @ViewBuilder
    private var avatar: some View {

        Group {
            if let person {
                ResidentAvatar(user: person, size: .row)
            } else {
                Image(systemName: "person.crop.circle")
                    .font(.title)
                    .foregroundStyle(.secondary)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if isCompleted {
                Image(systemName: "checkmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color(uiColor: .systemGray))
                    .font(.caption)
                    .background(Circle().fill(Color(uiColor: .secondarySystemGroupedBackground)))
            }
        }
        .accessibilityHidden(true)
    }

    private var statusLine: Text {

        guard let timing else { return status }

        return Text("\(status) · \(timing)")
    }

    private var status: Text {

        let you = Text("você").bold()

        if isCompleted {
            if item.occurrence.completedByUserID == currentUserID {
                return Text("Feita por \(you)")
            }
            if let person {
                return Text("Feita por \(ResidentNameFormatting.shortName(person.name))")
            }
            return Text("Feita")
        }

        if let assignee = item.assignee {
            return assignee.id == currentUserID
                ? Text("Para \(you)")
                : Text("Para \(ResidentNameFormatting.shortName(assignee.name))")
        }

        if let suggested = item.suggestedAssignee {
            return Text("Sugestão: \(ResidentNameFormatting.shortName(suggested.name))")
        }

        return Text("Sem responsável")
    }
}

/// Seta das linhas do cômodo que abrem o detalhe da tarefa.
struct RoomRowChevron: View {

    var body: some View {
        Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }
}

extension View {

    /// Altura mínima e área de toque das linhas de tarefa do cômodo.
    func roomTaskRowFrame() -> some View {
        frame(maxWidth: .infinity, minHeight: DesignSystem.minimumTouchTarget, alignment: .leading)
            .contentShape(Rectangle())
    }
}
