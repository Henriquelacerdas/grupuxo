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
            WeekSummarySheet(summary: viewModel.summary, currentUserID: viewModel.userID)
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

            if let level = draft.level {
                Text(WeekRatingText.tagsQuestion(for: level))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                FlowChips(items: RatingTag.options(for: level), selected: draft.tags) { tag in
                    viewModel.toggle(tag, for: item.roomID)
                }
            }
        }
        .padding(.vertical, DesignSystem.Spacing.small)
    }
}

/// Folha "Resumo da semana" (Figma): o período e as tarefas feitas na casa; "Seu cômodo" com o nível, as avaliações e as
/// tags de quem cuidou; e "Casa" com os demais cômodos (só nível e contagem). Nunca mostra quem avaliou.
struct WeekSummarySheet: View {

    let summary: WeekSummary
    let currentUserID: User.ID
    @Environment(\.dismiss) private var dismiss

    var body: some View {

        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                        Text(WeekRatingText.period(from: summary.weekStart, to: summary.weekEnd))
                            .font(.title2.bold())
                        Text("\(summary.tasksDone) de \(summary.tasksTotal) tarefas feitas na casa")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                ForEach(Array(summary.mine.enumerated()), id: \.element.id) { index, room in
                    Section {
                        myRoomCard(room)
                    } header: {
                        if index == 0 { Text(summary.mine.count == 1 ? "Seu cômodo" : "Seus cômodos") }
                    } footer: {
                        Text("As tags aparecem sem nome e sem contagem. Só quem cuidou do cômodo (\(caretakers(of: room))) vê esta parte.")
                    }
                }

                if !summary.house.isEmpty || !summary.upcomingRoomNames.isEmpty {
                    Section {
                        ForEach(summary.house) { room in
                            roomRow(room)
                        }
                    } header: {
                        Text("Casa")
                    } footer: {
                        Text(houseFooter)
                    }
                }
            }
            .navigationTitle("Resumo da semana")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                }
            }
        }
    }

    private func myRoomCard(_ room: RoomWeekResult) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {

            roomLine(room)

            let good = room.tags.filter { !$0.isImprovement }
            let improve = room.tags.filter(\.isImprovement)

            if !good.isEmpty {
                tagGroup(title: "O que foi bom", tags: good)
            }
            if !improve.isEmpty {
                tagGroup(title: "O que pode melhorar", tags: improve)
            }
        }
        .padding(.vertical, DesignSystem.Spacing.extraSmall)
    }

    private func roomRow(_ room: RoomWeekResult) -> some View {
        roomLine(room).padding(.vertical, DesignSystem.Spacing.extraSmall)
    }

    /// Nome e "N avaliações" à esquerda; o nível à direita ("—" quando faltam avaliações).
    private func roomLine(_ room: RoomWeekResult) -> some View {

        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(room.roomName).font(.headline)
                Text(room.level == nil ? "Poucas avaliações para mostrar" : WeekRatingText.ratingCount(room.ratingCount))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let level = room.level {
                Text(WeekRatingText.title(level))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("—").foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func tagGroup(title: LocalizedStringKey, tags: [RatingTag]) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {
            Text(title)
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            FlexibleLayout(spacing: DesignSystem.Spacing.small) {
                ForEach(tags, id: \.self) { tag in
                    Text(WeekRatingText.title(tag))
                        .font(.subheadline)
                        .padding(.horizontal, DesignSystem.Spacing.medium)
                        .padding(.vertical, DesignSystem.Spacing.small)
                        .background(Color.secondary.opacity(DesignSystem.tintedFillOpacity), in: .capsule)
                }
            }
        }
    }

    /// "você e Henrique L.": quem cuidou do cômodo, com "você" no lugar do próprio morador.
    private func caretakers(of room: RoomWeekResult) -> String {
        let names = zip(room.responsibleUserIDs, room.responsibleNames).map { id, name in
            id == currentUserID ? String(localized: "você") : ResidentNameFormatting.shortName(name)
        }
        return ListFormatter.localizedString(byJoining: names)
    }

    private var houseFooter: String {
        let names = ListFormatter.localizedString(byJoining: summary.upcomingRoomNames)
        let note = switch summary.upcomingRoomNames.count {
        case 0: ""
        case 1: String(localized: "A \(names) entra no resumo quando o ciclo dela terminar.")
        default: String(localized: "\(names) entram no resumo quando o ciclo deles terminar.")
        }
        let anonymity = String(localized: "Ninguém vê quem avaliou.")
        return note.isEmpty ? anonymity : "\(anonymity) \(note)"
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
                        .font(.subheadline)
                        .padding(.horizontal, DesignSystem.Spacing.medium)
                        .padding(.vertical, DesignSystem.Spacing.small)
                        .background(
                            (selected.contains(tag) ? Color.accentColor : Color.secondary)
                                .opacity(DesignSystem.tintedFillOpacity),
                            in: .capsule
                        )
                        .foregroundStyle(selected.contains(tag) ? Color.accentColor : Color.primary)
                        // O visual segue compacto, mas a área de toque chega a 44 pt (HIG).
                        .frame(minHeight: DesignSystem.minimumTouchTarget)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
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
