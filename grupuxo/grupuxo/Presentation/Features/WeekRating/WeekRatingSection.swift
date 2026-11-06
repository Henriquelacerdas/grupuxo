import GrupuxoDomain
import SwiftUI

/// No topo de Minhas tarefas: "Avaliar a semana / Termina terça" e "Resumo da semana", quando há o que mostrar.
struct WeekRatingSection: View {

    @ObservedObject var viewModel: WeekRatingViewModel

    @State private var isRating = false
    @State private var isShowingSummary = false

    var body: some View {

        Group {
            if viewModel.hasPending {
                row(
                    title: "Avaliar a semana",
                    subtitle: viewModel.closesAt.map { Text(WeekRatingText.closing($0)) },
                    systemImage: "checklist"
                ) { isRating = true }
                .accessibilityIdentifier("rateWeek")
            }

            if viewModel.hasSummary {
                row(title: "Resumo da semana", subtitle: nil, systemImage: "list.bullet.clipboard.fill") {
                    isShowingSummary = true
                }
                .accessibilityIdentifier("weekSummary")
            }
        }
        .task { await viewModel.load() }
        .sheet(isPresented: $isRating) {
            RateWeekSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $isShowingSummary) {
            WeekSummarySheet(results: viewModel.summary)
        }
    }

    private func row(title: LocalizedStringKey, subtitle: Text?, systemImage: String, action: @escaping () -> Void) -> some View {

        Button(action: action) {
            HStack(spacing: DesignSystem.Spacing.medium) {
                Image(systemName: systemImage)
                    .foregroundStyle(.tint)
                    .frame(width: DesignSystem.minimumTouchTarget - 8)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                    if let subtitle {
                        subtitle.font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Folha "Avaliar a semana": um cartão por cômodo, com os três níveis e as tags (opcionais). Fechar sem enviar não grava.
struct RateWeekSheet: View {

    @ObservedObject var viewModel: WeekRatingViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.showToast) private var showToast

    var body: some View {

        NavigationStack {
            List {
                Section {
                    ForEach(viewModel.pending) { item in
                        card(item)
                    }
                } footer: {
                    Text("Sua avaliação é anônima: ninguém vê quem avaliou. O resultado aparece para quem cuidou do cômodo.")
                }
            }
            .navigationTitle("Avaliar a semana")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.isSaving {
                        ProgressView()
                    } else {
                        Button("Enviar") {
                            Task {
                                if await viewModel.submit() {
                                    showToast(.created(String(localized: "Avaliação enviada")))
                                    dismiss()
                                }
                            }
                        }
                        .disabled(!viewModel.canSubmit)
                        .accessibilityIdentifier("submitRating")
                    }
                }
            }
            .alert(
                "Não foi possível enviar",
                isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
            ) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
        .interactiveDismissDisabled(viewModel.isSaving)
    }

    private func card(_ item: PendingRating) -> some View {

        let draft = viewModel.draft(for: item.roomID)

        return VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {

            Text(item.roomName).font(.headline)

            HStack(spacing: DesignSystem.Spacing.small) {
                ForEach(RatingLevel.allCases, id: \.self) { level in
                    Button {
                        viewModel.select(level, for: item.roomID)
                    } label: {
                        Label(WeekRatingText.title(level), systemImage: WeekRatingText.systemImage(level))
                            .font(.footnote.weight(.semibold))
                            .labelStyle(.titleOnly)
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.bordered)
                    .tint(draft.level == level ? .accentColor : .secondary)
                    .accessibilityAddTraits(draft.level == level ? .isSelected : [])
                }
            }

            if draft.level != nil {
                FlowChips(items: RatingTag.allCases, selected: draft.tags) { tag in
                    viewModel.toggle(tag, for: item.roomID)
                }
            }
        }
        .padding(.vertical, DesignSystem.Spacing.small)
    }
}

/// Folha "Resumo da semana": o resultado de cada cômodo de que a pessoa cuidou (só o agregado).
struct WeekSummarySheet: View {

    let results: [RatingResult]
    @Environment(\.dismiss) private var dismiss

    var body: some View {

        NavigationStack {
            List(results) { result in
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {
                    HStack {
                        Text(result.roomName).font(.headline)
                        Spacer()
                        Label(WeekRatingText.title(result.level), systemImage: WeekRatingText.systemImage(result.level))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.tint)
                    }
                    if !result.tags.isEmpty {
                        Text(result.tags.map(WeekRatingText.title).joined(separator: " · "))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, DesignSystem.Spacing.extraSmall)
            }
            .navigationTitle("Resumo da semana")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("OK") { dismiss() }
                }
            }
        }
    }
}

/// Chips que quebram de linha (as tags da avaliação).
private struct FlowChips: View {

    let items: [RatingTag]
    let selected: Set<RatingTag>
    let onTap: (RatingTag) -> Void

    var body: some View {
        FlexibleLayout(spacing: DesignSystem.Spacing.small) {
            ForEach(items, id: \.self) { tag in
                Button {
                    onTap(tag)
                } label: {
                    Text(WeekRatingText.title(tag))
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(selected.contains(tag) ? .accentColor : .secondary)
                .accessibilityAddTraits(selected.contains(tag) ? .isSelected : [])
            }
        }
    }
}

/// Layout simples de linhas que quebram quando não cabe.
private struct FlexibleLayout: Layout {

    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}
