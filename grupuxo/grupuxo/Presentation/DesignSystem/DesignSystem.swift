import SwiftUI
import GrupuxoDomain

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
    static let cardCornerRadius: CGFloat = 24
}

/// Barra de progresso do ciclo: trilho neutro e preenchimento na cor do cômodo.
/// Sem progresso a barra mostra só a ponta arredondada, para o trilho não parecer vazio.
struct CycleProgressViewStyle: ProgressViewStyle {

    let tint: Color

    @ScaledMetric(relativeTo: .caption) private var barHeight: CGFloat = 6

    func makeBody(configuration: Configuration) -> some View {

        let fraction = min(max(configuration.fractionCompleted ?? 0, 0), 1)

        Capsule()
            .fill(Color(uiColor: .systemFill))
            .frame(height: barHeight)
            .overlay(alignment: .leading) {

                GeometryReader { proxy in

                    Capsule()
                        .fill(tint)
                        .frame(width: max(barHeight, proxy.size.width * fraction))
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Progresso do ciclo")
            .accessibilityValue(
                fraction.formatted(.percent.precision(.fractionLength(0)))
            )
    }
}

extension ProgressViewStyle where Self == CycleProgressViewStyle {

    static func cycle(tint: Color) -> CycleProgressViewStyle {
        CycleProgressViewStyle(tint: tint)
    }
}

extension View {

    /// Cartão com fundo agrupado secundário, que acompanha modo escuro e contraste do sistema.
    /// Sobre fundo não agrupado (lista `.plain`), passe `Color(uiColor: .secondarySystemBackground)`.
    func cardBackground(
        _ fill: Color = Color(uiColor: .secondarySystemGroupedBackground)
    ) -> some View {
        background(
            fill,
            in: RoundedRectangle(
                cornerRadius: DesignSystem.cardCornerRadius,
                style: .continuous
            )
        )
    }

    /// A linha da lista vira só um espaço: o fundo e o arredondamento ficam no cartão.
    func plainCardRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(
                EdgeInsets(
                    top: 0,
                    leading: DesignSystem.Spacing.large,
                    bottom: 0,
                    trailing: DesignSystem.Spacing.large
                )
            )
    }

    /// Botão de ação principal da barra de navegação (vidro no iOS 26, preenchido antes).
    @ViewBuilder
    func prominentToolbarButtonStyle() -> some View {

        if #available(iOS 26, *) {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent)
        }
    }
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

    @ScaledMetric(relativeTo: .caption) private var diameter: CGFloat = 36

    var body: some View {
        Text(user.name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined())
            .font(.caption.bold())
            .foregroundStyle(.tint)
            .frame(width: diameter, height: diameter)
            .background(.tint.opacity(0.12), in: Circle())
            .accessibilityHidden(true)
    }
}

struct TaskRow: View {

    let item: TaskItem
    var canComplete = false
    var onComplete: () -> Void = {}
    var onSelect: (() -> Void)? = nil

    var body: some View {

        HStack(
            alignment: .top,
            spacing: DesignSystem.Spacing.small
        ) {

            Button {
                Haptics.completionToggled(wasCompleted: item.occurrence.isCompleted)
                onComplete()
            } label: {

                Image(
                    systemName:
                        item.occurrence.isCompleted
                        ? "checkmark.circle.fill"
                        : "circle"
                )
                .font(.title2)
                .foregroundStyle(
                    item.occurrence.isCompleted
                    ? AnyShapeStyle(.tint)
                    : AnyShapeStyle(.secondary)
                )
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 44, height: 44)

            }
            .buttonStyle(.borderless)
            .disabled(!canComplete)
            .accessibilityLabel(
                item.occurrence.isCompleted
                ? "Desmarcar conclusão de \(item.definition.name)"
                : "Concluir \(item.definition.name)"
            )
            .accessibilityValue(
                item.occurrence.isCompleted
                ? "Concluída"
                : "Pendente"
            )

            if let onSelect {

                Button(action: onSelect) {

                    taskContent
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                        .contentShape(Rectangle())

                }
                .buttonStyle(.plain)

            } else {

                taskContent
                    .frame(
                        maxWidth: .infinity,
                        alignment: .leading
                    )

            }

        }

    }

    private var taskContent: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.extraSmall
        ) {

            Text(item.definition.name)
                .font(.headline)
                .strikethrough(
                    item.occurrence.isCompleted
                )

            if !item.definition.details.isEmpty {

                Text(item.definition.details)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

            }

            if let user = item.assignee {

                HStack {

                    ResidentAvatar(
                        user: user
                    )

                    Text(user.name)
                        .font(.subheadline)

                }
                .accessibilityElement(
                    children: .combine
                )
                .accessibilityLabel(
                    "Responsável: \(user.name)"
                )

            } else if let user = item.suggestedAssignee {

                Text(
                    "Morador sugerido: \(user.name)"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)

            } else {

                Label(
                    "Sem responsável",
                    systemImage:
                        "person.crop.circle.badge.questionmark"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)

            }

            if let dueAt = item.occurrence.dueAt {

                Text(
                    "Prazo: \(dueAt.formatted(date: .abbreviated, time: .shortened))"
                )
                .font(.caption)
                .foregroundStyle(.secondary)

            } else {

                Text("Sem prazo")
                    .font(.caption)
                    .foregroundStyle(.secondary)

            }

            if item.occurrence.isCompleted {

                Text("Concluída")
                    .font(.caption)
                    .foregroundStyle(.secondary)

            }

        }

    }

}
