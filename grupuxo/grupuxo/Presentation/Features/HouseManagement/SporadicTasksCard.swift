import Foundation
import SwiftUI
import GrupuxoDomain

struct SporadicTasksCard: View {

    let summary: SporadicSummary
    let onSelect: () -> Void

    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 32

    var body: some View {

        Button(action: onSelect) {

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.medium
            ) {

                header

                if summary.isEmpty {

                    Text("Nenhuma tarefa única no momento.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                } else {

                    ForEach(summary.rows) { row in
                        rowView(row)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignSystem.Spacing.large)
            .cardBackground()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Tarefas únicas")
        .accessibilityValue(accessibilityValue)
        .accessibilityHint("Abre as tarefas únicas da casa")
        .accessibilityIdentifier("sporadicTasksCard")
    }

    private var header: some View {

        HStack(spacing: DesignSystem.Spacing.small) {

            Label {

                Text("Tarefas Únicas")
                    .font(.title3.bold())
                    .foregroundStyle(.primary)

            } icon: {

                Image(systemName: "flag.fill")
                    .foregroundStyle(.red)
            }

            Spacer(minLength: DesignSystem.Spacing.small)

            Image(systemName: "chevron.right")
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func rowView(
        _ row: SporadicSummary.Row
    ) -> some View {

        switch row {

        case let .task(_, name, icon, color):

            HStack(spacing: DesignSystem.Spacing.medium) {

                RoomIconView(icon: icon, color: color, size: iconSize)

                Text(name)
                    .font(.body)
                    .foregroundStyle(.primary)
            }

        case let .overflow(count):

            HStack(spacing: DesignSystem.Spacing.medium) {

                Text("+\(count)")
                    .font(.footnote.bold())
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .frame(width: iconSize, height: iconSize)
                    .background(RoomColor.gray.tint.gradient, in: Circle())
                    .accessibilityHidden(true)

                Text(HouseOverviewText.overflowTitle)
                    .font(.body)
                    .foregroundStyle(.primary)
            }
        }
    }

    private var accessibilityValue: String {

        guard !summary.isEmpty else { return String(localized: "Nenhuma tarefa") }

        let names = summary.rows.compactMap { row -> String? in
            if case let .task(_, name, _, _) = row { name } else { nil }
        }

        let overflow = summary.totalCount - names.count

        let listed = ListFormatter.localizedString(byJoining: names)

        return overflow > 0
            ? String(localized: "\(listed) e mais \(overflow)")
            : listed
    }
}
