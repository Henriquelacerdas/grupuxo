import SwiftUI
import GrupuxoDomain

/// Card de um cômodo de que o morador participa.
struct RoomCard: View {

    let row: RoomRow
    let member: RoomRow.Member

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @ScaledMetric(relativeTo: .title) private var iconSize: CGFloat = 56
    @ScaledMetric(relativeTo: .body) private var symbolColumnWidth: CGFloat = 22

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.medium
        ) {

            mainContent

            progressSection
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.medium)
        .cardBackground()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.name)
        .accessibilityValue(accessibilityValue)
    }

    // No tamanho de acessibilidade o ícone passa para cima do texto, liberando largura.
    private var mainContent: some View {

        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: DesignSystem.Spacing.medium))
            : AnyLayout(HStackLayout(alignment: .center, spacing: DesignSystem.Spacing.large))

        return layout {

            RoomIconView(
                icon: row.icon,
                color: row.color,
                size: iconSize
            )

            details
        }
    }

    private var details: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.extraSmall
        ) {

            titleRow

            if let responsibles = member.responsibles {

                infoRow(systemImage: "repeat") {

                    Text(responsibles)
                        .foregroundStyle(.primary)
                }
            }

            infoRow(systemImage: "clock") {

                Text(member.deadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleRow: some View {

        HStack(
            alignment: .firstTextBaseline,
            spacing: DesignSystem.Spacing.small
        ) {

            Text(row.name)
                .font(.title3.bold())
                .foregroundStyle(.primary)

            if member.isPrivate {

                Image(systemName: "lock.open.fill")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }

            Spacer(minLength: DesignSystem.Spacing.small)

            Image(systemName: "chevron.right")
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
    }

    private var progressSection: some View {

        VStack(
            alignment: .trailing,
            spacing: DesignSystem.Spacing.extraSmall
        ) {

            ProgressView(
                value: Double(member.progress.completed),
                total: Double(max(member.progress.total, 1))
            )
            .progressViewStyle(.cycle(tint: row.color.tint))

            Text(HouseOverviewText.progress(member.progress))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func infoRow<Content: View>(
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {

        HStack(
            alignment: .firstTextBaseline,
            spacing: DesignSystem.Spacing.small
        ) {

            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: symbolColumnWidth)
                .accessibilityHidden(true)

            content()
                .font(.body)
        }
    }

    private var accessibilityValue: String {

        var parts: [String] = []

        if member.isPrivate {
            parts.append("Cômodo privado")
        }

        if let responsibles = member.responsibles {
            parts.append("Responsáveis: \(responsibles)")
        }

        parts.append(member.deadline)
        parts.append(HouseOverviewText.progress(member.progress))

        return parts.joined(separator: ". ")
    }
}

/// Card de um cômodo privado de que o morador não participa: só nome, cadeado e pedido de entrada.
struct RestrictedRoomCard: View {

    let row: RoomRow
    let requestPending: Bool
    let onRequest: () -> Void
    let onCancel: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @ScaledMetric(relativeTo: .title) private var iconSize: CGFloat = 48

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.small
        ) {

            header

            requestButton
                .buttonStyle(.bordered)
                .buttonBorderShape(.roundedRectangle(radius: DesignSystem.cornerRadius))
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.medium)
        .cardBackground()
    }

    private var header: some View {

        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: DesignSystem.Spacing.medium))
            : AnyLayout(HStackLayout(alignment: .center, spacing: DesignSystem.Spacing.large))

        return layout {

            RoomIconView(
                icon: row.icon,
                color: row.color,
                size: iconSize
            )

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.extraSmall
            ) {

                Text(row.name)
                    .font(.title3.bold())
                    .foregroundStyle(.primary)

                Label(
                    HouseOverviewText.privateRoom,
                    systemImage: "lock.fill"
                )
                .font(.body)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.name)
        .accessibilityValue("Cômodo privado, sem acesso")
    }

    @ViewBuilder
    private var requestButton: some View {

        if requestPending {

            Button(action: onCancel) {

                Text("Cancelar solicitação")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .tint(.gray)
            .foregroundStyle(.primary)
            .accessibilityIdentifier("cancelAccessRequest")

        } else {

            Button(action: onRequest) {

                Text("Pedir para entrar")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("requestAccess")
        }
    }
}
