import GrupuxoDomain
import SwiftUI

/// No topo de Minhas tarefas (Figma "Linha do Resumo em Minhas tarefas · estados"): "Avaliar a semana / Termina terça"
/// enquanto a avaliação está aberta, "Avaliação enviada / O resumo sai terça" depois de enviar e "Resumo da semana"
/// quando o resultado sai.
struct WeekRatingSection: View {

    @ObservedObject var viewModel: WeekRatingViewModel

    var body: some View {

        Group {
            if viewModel.hasPending {
                card(
                    title: "Avaliar a semana",
                    subtitle: viewModel.closesAt.map { Text(WeekRatingText.closing($0)) },
                    systemImage: "star.fill",
                    isActive: true,
                    showsChevron: true
                ) { viewModel.isRatingPresented = true }
                .accessibilityIdentifier("rateWeek")
            }

            if viewModel.hasSubmitted, let until = viewModel.submittedUntil {
                card(
                    title: "Avaliação enviada",
                    subtitle: Text(WeekRatingText.summaryComes(until)),
                    systemImage: "checkmark",
                    isActive: false,
                    showsChevron: false
                )
                .accessibilityIdentifier("ratingSent")
            }

            if viewModel.hasSummary {
                card(
                    title: "Resumo da semana",
                    subtitle: Text("Veja como ficaram os cômodos"),
                    systemImage: "list.bullet.clipboard.fill",
                    isActive: true,
                    showsChevron: true
                ) { viewModel.isSummaryPresented = true }
                .accessibilityIdentifier("weekSummary")
            }
        }
        // O carregamento fica em `MyTasksView`: um `.task` aqui não roda enquanto o `Group` está vazio (nada a mostrar),
        // e então as avaliações nunca chegariam.
    }

    /// Cartão de 24 pt de raio com ícone de 36 pt, título, subtítulo e, quando abre algo, a seta.
    private func card(
        title: LocalizedStringKey, subtitle: Text?, systemImage: String, isActive: Bool, showsChevron: Bool,
        action: (() -> Void)? = nil
    ) -> some View {

        let content = HStack(spacing: DesignSystem.Spacing.medium) {

            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isActive ? Color.white : Color.secondary)
                .frame(width: 36, height: 36)
                .background(isActive ? Color.accentColor : Color(.tertiarySystemFill), in: .circle)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                if let subtitle {
                    subtitle.font(.subheadline).foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)

            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.medium)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground(Color(uiColor: .secondarySystemBackground))
        .contentShape(Rectangle())

        return Group {
            if let action {
                Button(action: action) { content }.buttonStyle(.plain)
            } else {
                content.accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, DesignSystem.Spacing.extraSmall)
        .plainCardRow()
        .listRowSeparator(.hidden)
    }
}

/// Dono das folhas "Avaliar a semana" e "Resumo da semana". Fica num lugar estável (fundo da lista), não na linha:
/// uma linha de `List` é reciclada e a folha abria e fechava sozinha.
struct WeekRatingSheetHost: View {

    @ObservedObject var viewModel: WeekRatingViewModel

    var body: some View {
        Color.clear
            .sheet(isPresented: $viewModel.isRatingPresented) {
                RateWeekSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $viewModel.isSummaryPresented) {
                WeekSummarySheet(summary: viewModel.summary, currentUserID: viewModel.userID, looks: viewModel.roomLooks)
            }
    }
}

// MARK: - Avaliar a semana

/// Folha "Avaliar a semana" (Figma): "Como ficaram os cômodos?" e um cartão por cômodo, com os três níveis e, depois de
/// escolher um, as tags (opcionais). X fecha sem gravar; o ✓ envia.
struct RateWeekSheet: View {

    @ObservedObject var viewModel: WeekRatingViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.showToast) private var showToast

    var body: some View {

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.large + DesignSystem.Spacing.extraSmall) {

                    intro

                    ForEach(viewModel.pending) { item in
                        card(item)
                    }

                    Text("Entram só os cômodos cujo ciclo terminou nesta semana. O resultado de cada cômodo só aparece com 2 avaliações ou mais, e ninguém vê quem avaliou.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, DesignSystem.Spacing.large)
                .padding(.top, DesignSystem.Spacing.medium)
                .padding(.bottom, DesignSystem.Spacing.large * 2)
            }
            .background(Color(.systemGroupedBackground))
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
                        Button("Enviar", systemImage: "checkmark") {
                            Task {
                                if await viewModel.submit() {
                                    showToast(.created(String(localized: "Avaliação enviada")))
                                    dismiss()
                                }
                            }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderedProminent)
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

    private var intro: some View {

        VStack(alignment: .leading, spacing: 6) {
            Text("Como ficaram os cômodos?")
                .roundedFont(.title2.bold())
            Text("Sua avaliação é anônima. Você não avalia o cômodo que cuidou.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card(_ item: PendingRating) -> some View {

        let draft = viewModel.draft(for: item.roomID)

        return VStack(alignment: .leading, spacing: 14) {

            RoomTitle(name: item.roomName, look: viewModel.roomLooks[item.roomID])

            // O visual tem 40 pt e o toque 44: o espaço entre linhas desconta a diferença para o vão ficar em 8 pt.
            FlexibleLayout(spacing: DesignSystem.Spacing.small, lineSpacing: DesignSystem.Spacing.small - 4) {
                ForEach(RatingLevel.allCases, id: \.self) { level in
                    LevelPill(title: WeekRatingText.title(level), isSelected: draft.level == level) {
                        viewModel.select(level, for: item.roomID)
                    }
                }
            }

            if let level = draft.level {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {
                    Text(WeekRatingText.tagsQuestion(for: level))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    FlexibleLayout(spacing: DesignSystem.Spacing.small, lineSpacing: DesignSystem.Spacing.small - 12) {
                        ForEach(RatingTag.options(for: level), id: \.self) { tag in
                            TagChip(title: WeekRatingText.title(tag), isSelected: draft.tags.contains(tag)) {
                                viewModel.toggle(tag, for: item.roomID)
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.top, 14)
        .padding(.bottom, DesignSystem.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// Ícone do cômodo (32 pt) e nome, como nos cartões da avaliação e do resumo.
private struct RoomTitle: View {

    let name: String
    let look: WeekRatingViewModel.RoomLook?

    var body: some View {
        HStack(spacing: DesignSystem.Spacing.medium) {
            if let look {
                RoomIconView(icon: look.icon, color: look.color, size: 32)
            }
            Text(name).font(.body.weight(.semibold))
        }
    }
}

/// Um dos três níveis. O visual tem 40 pt (Figma); a área de toque chega a 44 pt (HIG).
private struct LevelPill: View {

    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isSelected ? Color.white : Color.primary)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .background(isSelected ? Color.accentColor : Color(.tertiarySystemFill), in: .capsule)
                .frame(minHeight: DesignSystem.minimumTouchTarget)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Tag da avaliação. Marcada: fundo e texto na cor de destaque, com ✓ (Figma). Visual de 32 pt, toque de 44 pt.
private struct TagChip: View {

    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isSelected {
                    Text("\(Image(systemName: "checkmark")) \(title)")
                } else {
                    Text(title)
                }
            }
            .font(.subheadline)
            .foregroundStyle(isSelected ? Color.accentColor : Color.primary)
            .padding(.horizontal, DesignSystem.Spacing.medium)
            .frame(height: 32)
            .background(isSelected ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemFill), in: .capsule)
            .frame(minHeight: DesignSystem.minimumTouchTarget)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Resumo da semana

/// Folha "Resumo da semana" (Figma): o período e as tarefas feitas na casa; "Seu cômodo" com o nível, as avaliações e as
/// tags de quem cuidou; e "Casa" com os demais cômodos (só nível e contagem). Nunca mostra quem avaliou.
struct WeekSummarySheet: View {

    let summary: WeekSummary
    let currentUserID: User.ID
    let looks: [Room.ID: WeekRatingViewModel.RoomLook]
    @Environment(\.dismiss) private var dismiss

    var body: some View {

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.large + DesignSystem.Spacing.extraSmall) {

                    VStack(alignment: .leading, spacing: 6) {
                        Text(WeekRatingText.period(from: summary.weekStart, to: summary.weekEnd))
                            .roundedFont(.title2.bold())
                        Text("\(summary.tasksDone) de \(summary.tasksTotal) tarefas feitas na casa")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(Array(summary.mine.enumerated()), id: \.element.id) { index, room in
                        section(
                            title: index == 0 ? (summary.mine.count == 1 ? "Seu cômodo" : "Seus cômodos") : nil,
                            footer: String(localized: "As tags aparecem sem nome e sem contagem. Só quem cuidou do cômodo (\(caretakers(of: room))) vê esta parte.")
                        ) {
                            myRoomRows(room)
                        }
                    }

                    if !summary.house.isEmpty || !summary.upcomingRoomNames.isEmpty {
                        section(title: "Casa", footer: houseFooter) {
                            ForEach(Array(summary.house.enumerated()), id: \.element.id) { index, room in
                                if index > 0 { Divider().padding(.leading, DesignSystem.Spacing.large) }
                                roomLine(room)
                            }
                        }
                    }
                }
                .padding(.horizontal, DesignSystem.Spacing.large)
                .padding(.top, DesignSystem.Spacing.medium)
                .padding(.bottom, DesignSystem.Spacing.large * 2)
            }
            .background(Color(.systemGroupedBackground))
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

    /// Título da seção (17 pt, semibold), cartão arredondado e nota abaixo.
    private func section<Content: View>(
        title: LocalizedStringKey?, footer: String, @ViewBuilder content: () -> Content
    ) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {

            if let title {
                Text(title).font(.body.weight(.semibold)).accessibilityAddTraits(.isHeader)
            }

            VStack(spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardBackground()

            Text(footer)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func myRoomRows(_ room: RoomWeekResult) -> some View {

        let good = room.tags.filter { !$0.isImprovement }
        let improve = room.tags.filter(\.isImprovement)

        return VStack(alignment: .leading, spacing: 0) {

            roomLine(room)

            if !good.isEmpty || !improve.isEmpty {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {
                    if !good.isEmpty { tagGroup(title: "O que foi bom", tags: good) }
                    if !improve.isEmpty { tagGroup(title: "O que pode melhorar", tags: improve) }
                }
                .padding(.horizontal, DesignSystem.Spacing.large)
                .padding(.top, 4)
                .padding(.bottom, DesignSystem.Spacing.large)
            }
        }
    }

    /// Ícone, nome e "N avaliações" à esquerda; o nível à direita ("—" quando faltam avaliações).
    private func roomLine(_ room: RoomWeekResult) -> some View {

        HStack(spacing: DesignSystem.Spacing.medium) {

            if let look = looks[room.roomID] {
                RoomIconView(icon: look.icon, color: look.color, size: 32)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(room.roomName).font(.body)
                Text(room.level == nil ? "Poucas avaliações para mostrar" : WeekRatingText.ratingCount(room.ratingCount))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: DesignSystem.Spacing.small)

            Text(room.level.map { WeekRatingText.title($0) } ?? "—")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func tagGroup(title: LocalizedStringKey, tags: [RatingTag]) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.small) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            FlexibleLayout(spacing: DesignSystem.Spacing.small, lineSpacing: DesignSystem.Spacing.small) {
                ForEach(tags, id: \.self) { tag in
                    Text(WeekRatingText.title(tag))
                        .font(.subheadline)
                        .padding(.horizontal, DesignSystem.Spacing.medium)
                        .frame(height: 32)
                        .background(Color(.tertiarySystemFill), in: .capsule)
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

/// Layout simples de linhas que quebram quando não cabe. `lineSpacing` pode ser menor que o espaço entre os itens
/// (negativo inclusive) quando a altura de toque passa da altura visual.
private struct FlexibleLayout: Layout {

    var spacing: CGFloat
    var lineSpacing: CGFloat

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
                y += rowHeight + lineSpacing
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
