import Foundation
import SwiftUI
import GrupuxoDomain

struct RoomDetailView: View {

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @StateObject private var viewModel: RoomDetailViewModel

    @State private var filter: RoomTaskFilter = .now
    @State private var selectedSuggestion: TaskSuggestion?
    @State private var taskToEnd: TaskDefinition?
    @State private var isShowingRoomDetails = false
    @State private var isShowingCycleInfo = false
    @State private var isPresentingTaskCreationSheet = false

    private let makeSuggestionEditorViewModel: (TaskSuggestion) -> TaskEditorViewModel
    private let makeTaskEditorViewModel: () -> TaskEditorViewModel
    private let onSelectTask: (TaskDefinition.ID) -> Void
    private let reloadTrigger: AnyHashable

    init(
        viewModel: RoomDetailViewModel,
        makeSuggestionEditorViewModel: @escaping (TaskSuggestion) -> TaskEditorViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        onSelectTask: @escaping (TaskDefinition.ID) -> Void,
        reloadTrigger: AnyHashable = 0
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.makeSuggestionEditorViewModel = makeSuggestionEditorViewModel
        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.onSelectTask = onSelectTask
        self.reloadTrigger = reloadTrigger
    }

    private var isMember: Bool {
        viewModel.participation?.isMember == true
    }

    private var canLeaveRoom: Bool {
        isMember && viewModel.participation?.room.representsWholeHouse == false
    }

    private var roomTint: Color {
        viewModel.participation?.room.color.tint ?? .accentColor
    }

    var body: some View {

        ScrollView {

            VStack(alignment: .leading, spacing: sectionSpacing) {

                if let info = viewModel.participation {

                    if info.isMember {
                        summaryCard
                    } else {
                        joinCard
                    }
                }

                tasksContent

                suggestionsSection
            }
            .padding(.horizontal, DesignSystem.Spacing.large)
            .padding(.bottom, DesignSystem.Spacing.large * 2)
        }
        .background { background }
        .navigationTitle(viewModel.participation?.room.name ?? String(localized: "Cômodo"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar { toolbarContent }
        .task(id: reloadTrigger) {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load()
        }
        .sheet(
            item: $selectedSuggestion,
            onDismiss: {
                Task { await viewModel.load() }
            }
        ) { suggestion in

            TaskCreationSheetView(
                viewModel: makeSuggestionEditorViewModel(suggestion)
            )
            .presentationDragIndicator(.hidden)
        }
        .sheet(
            isPresented: $isPresentingTaskCreationSheet,
            onDismiss: {
                Task { await viewModel.load() }
            }
        ) {

            TaskCreationSheetView(
                viewModel: makeTaskEditorViewModel()
            )
            .presentationDragIndicator(.visible)
        }
        .onChange(of: viewModel.wasDeleted) { _, deleted in
            if deleted { dismiss() }
        }
        .alert("Tarefas do ciclo", isPresented: $isShowingCycleInfo) {
            Button("OK") {}
        } message: {
            Text("São as tarefas que seguem a escala do cômodo. A cada ciclo, elas são divididas entre os responsáveis.")
        }
        .alert(
            "Encerrar tarefa?",
            isPresented: Binding(get: { taskToEnd != nil }, set: { if !$0 { taskToEnd = nil } }),
            presenting: taskToEnd
        ) { task in
            Button("Cancelar", role: .cancel) {}
            Button("Encerrar", role: .destructive) {
                Task { await viewModel.end(taskID: task.id) }
            }
        } message: { task in
            Text("\(task.name) não será mais repetida. O histórico fica, e a vez atual continua até ser concluída.")
        }
        .alert(
            "Sair e excluir cômodo?",
            isPresented: $viewModel.confirmsDeletion
        ) {
            Button("Cancelar", role: .cancel) {}
            Button("Sair e excluir", role: .destructive) {
                Task { await viewModel.leave(confirmDeletion: true) }
            }
        } message: {
            Text("Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.")
        }
        .alert(
            "Não foi possível realizar a ação",
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.actionError = nil } }
            )
        ) {
            Button("OK") { viewModel.actionError = nil }
        } message: {
            Text(viewModel.actionError ?? "")
        }
    }

    private var sectionSpacing: CGFloat { DesignSystem.Spacing.large + DesignSystem.Spacing.small }

    // MARK: - Chrome

    /// Fundo agrupado com um brilho na cor do cômodo que some até o meio da tela.
    private var background: some View {

        ZStack(alignment: .top) {

            Color(uiColor: .systemGroupedBackground)

            LinearGradient(
                colors: [roomTint.opacity(0.4), roomTint.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 280)
        }
        .ignoresSafeArea()
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {

        if viewModel.participation != nil {

            ToolbarItemGroup(placement: .topBarTrailing) {

                if isMember {

                    Button("Adicionar tarefa", systemImage: "plus") {
                        isPresentingTaskCreationSheet = true
                    }
                    .accessibilityIdentifier("createRoomTask")
                }

                if canLeaveRoom {

                    Menu("Mais opções", systemImage: "ellipsis") {

                        Button(
                            "Sair do cômodo",
                            systemImage: "rectangle.portrait.and.arrow.right",
                            role: .destructive
                        ) {
                            Task { await viewModel.leave() }
                        }
                        .disabled(viewModel.isChangingMembership)
                    }
                    .accessibilityIdentifier("roomOptions")
                }
            }
        }
    }

    // MARK: - Header cards

    /// Responsáveis do ciclo. O chevron expande, no próprio cartão, a duração do ciclo e os participantes.
    private var summaryCard: some View {

        VStack(spacing: 0) {

            Button {
                withAnimation(reduceMotion ? nil : .snappy) {
                    isShowingRoomDetails.toggle()
                }
            } label: {

                HStack(spacing: DesignSystem.Spacing.medium) {

                    Image(systemName: "repeat")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(roomTint)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                        Text(viewModel.responsiblesSummary ?? String(localized: "Sem responsáveis"))
                            .font(.headline)
                            .foregroundStyle(.primary)

                        if !isShowingRoomDetails, let deadline = viewModel.deadlineSummary {

                            Text(deadline)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Image(systemName: "chevron.right")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(roomTint)
                        .rotationEffect(.degrees(isShowingRoomDetails ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .padding(DesignSystem.Spacing.large)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isShowingRoomDetails ? "Expandido" : "Recolhido")
            .accessibilityHint("Mostra ou esconde a duração do ciclo e os participantes.")

            if isShowingRoomDetails {

                VStack(spacing: 0) {

                    if let duration = viewModel.cycleDurationSummary {

                        Divider()

                        detailRow(String(localized: "Duração do ciclo"), value: duration)
                    }

                    if let participants = viewModel.participantsSummary {

                        Divider()

                        detailRow(String(localized: "Participantes"), value: participants)
                    }
                }
                .padding(.leading, DesignSystem.Spacing.large)
                .transition(.opacity)
            }
        }
        .cardBackground()
    }

    private func detailRow(_ title: String, value: String) -> some View {

        LabeledContent(title) {

            Text(value)
                .foregroundStyle(.secondary)
        }
        .font(.body)
        .padding(.trailing, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.medium)
        .frame(minHeight: DesignSystem.minimumTouchTarget)
    }

    private var joinCard: some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {

            Text("Entre para consultar e criar tarefas neste cômodo.")
                .font(.body)

            Button {
                Task { await viewModel.join() }
            } label: {

                Text("Entrar no cômodo")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(viewModel.isChangingMembership)
        }
        .padding(DesignSystem.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    // MARK: - Tasks

    @ViewBuilder
    private var tasksContent: some View {

        switch viewModel.state {

        case .idle, .loading:

            ProgressView("Carregando cômodo…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, DesignSystem.Spacing.large)

        case let .content(content):

            if isMember {
                memberTasks(content)
            } else {
                preservedTasks(content)
            }

        case .empty:

            if isMember && viewModel.suggestions.isEmpty {

                Text("Nenhuma tarefa neste cômodo.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }

        case let .failure(message):

            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func memberTasks(_ content: RoomDetailContent) -> some View {

        let sections = RoomDetailSections(content: content, filter: filter, now: .now)

        Picker("Filtrar tarefas", selection: $filter) {

            ForEach(RoomTaskFilter.allCases, id: \.self) { option in
                Text(option.title).tag(option)
            }
        }
        .pickerStyle(.segmented)

        if sections.isEmpty {

            Text("Nada para fazer agora.")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, DesignSystem.Spacing.large)
        }

        if !sections.cycle.isEmpty {

            section(String(localized: "Tarefas do ciclo"), infoAction: { isShowingCycleInfo = true }) {

                card(sections.cycle) { recurringRow($0, includingRecurrence: false) }
            }
        }

        if !sections.general.isEmpty {

            section(String(localized: "Tarefas gerais")) {

                card(sections.general) { recurringRow($0, includingRecurrence: true) }
            }
        }

        if !sections.single.isEmpty {

            section(String(localized: "Tarefas únicas")) {

                card(sections.single) { singleRow($0) }
            }
        }
    }

    private func preservedTasks(_ content: RoomDetailContent) -> some View {

        section(String(localized: "Suas pendências preservadas")) {

            card(content.tasks) { recurringRow($0, includingRecurrence: true) }
        }
    }

    private func recurringRow(_ item: TaskItem, includingRecurrence: Bool) -> some View {

        Button {
            onSelectTask(item.definition.id)
        } label: {

            HStack(spacing: DesignSystem.Spacing.medium) {

                taskTexts(
                    name: item.definition.name,
                    subtitle: RoomDetailText.subtitle(
                        for: item.definition,
                        includingRecurrence: includingRecurrence
                    ),
                    isCompleted: item.occurrence.isCompleted
                )

                if item.occurrence.isCompleted {

                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityLabel("Concluída")
                }

                chevron
            }
            .rowPadding()
        }
        .buttonStyle(.plain)
        .contextMenu {

            if viewModel.canComplete(item) {

                Button(
                    item.occurrence.isCompleted ? "Desmarcar conclusão" : "Concluir",
                    systemImage: item.occurrence.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle"
                ) {
                    Haptics.completionToggled(wasCompleted: item.occurrence.isCompleted)
                    Task { await viewModel.complete(item.id) }
                }
            }

            if item.definition.endedAt == nil && isMember {

                Button("Encerrar", systemImage: "stop.circle", role: .destructive) {
                    taskToEnd = item.definition
                }
            }
        }
    }

    private func singleRow(_ item: TaskItem) -> some View {

        HStack(spacing: DesignSystem.Spacing.medium) {

            Button {
                onSelectTask(item.definition.id)
            } label: {

                HStack(spacing: DesignSystem.Spacing.medium) {

                    Image(systemName: "flag.fill")
                        .foregroundStyle(.red)
                        .frame(width: 28)
                        .accessibilityHidden(true)

                    taskTexts(
                        name: item.definition.name,
                        subtitle: RoomDetailText.singleTaskStatus(item, currentUserID: viewModel.currentUserID),
                        isCompleted: item.occurrence.isCompleted
                    )

                    if !viewModel.canClaim(item) {
                        chevron
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if viewModel.canClaim(item) {

                Button {
                    Task { await viewModel.claim(item.id) }
                } label: {

                    Text("Pegar")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, DesignSystem.Spacing.large)
                        .frame(minHeight: DesignSystem.minimumTouchTarget)
                        .background(Color(uiColor: .systemFill), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Pegar \(item.definition.name)")
            }
        }
        .rowPadding()
    }

    private func taskTexts(name: String, subtitle: String, isCompleted: Bool) -> some View {

        VStack(alignment: .leading, spacing: 2) {

            Text(name)
                .font(.body)
                .foregroundStyle(.primary)
                .strikethrough(isCompleted)

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var chevron: some View {

        Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }

    // MARK: - Suggestions

    @ViewBuilder
    private var suggestionsSection: some View {

        if !viewModel.suggestions.isEmpty {

            section(String(localized: "Sugestões de tarefas")) {

                VStack(spacing: 0) {

                    ForEach(viewModel.visibleSuggestions) { suggestion in

                        suggestionRow(suggestion)

                        Divider().padding(.leading, DesignSystem.Spacing.large)
                    }

                    if viewModel.hasOtherSuggestions {

                        Button {
                            withAnimation { viewModel.showOtherSuggestions() }
                        } label: {

                            Label("Outras sugestões", systemImage: "arrow.clockwise")
                                .font(.body)
                                .frame(maxWidth: .infinity, minHeight: DesignSystem.minimumTouchTarget)
                        }
                    }
                }
                .cardBackground()
            }
        }
    }

    private func suggestionRow(_ suggestion: TaskSuggestion) -> some View {

        Button {
            selectedSuggestion = suggestion
        } label: {

            HStack(spacing: DesignSystem.Spacing.medium) {

                taskTexts(
                    name: suggestion.name,
                    subtitle: RoomDetailText.effort(suggestion.effort),
                    isCompleted: false
                )

                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
            }
            .rowPadding()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre o formulário para editar e adicionar esta tarefa.")
    }

    // MARK: - Building blocks

    private func section<Content: View>(
        _ title: String,
        infoAction: (() -> Void)? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {

            HStack(spacing: DesignSystem.Spacing.small) {

                Text(title)
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)

                if let infoAction {

                    Button(action: infoAction) {

                        Image(systemName: "info.circle")
                            .font(.body)
                    }
                    .accessibilityLabel("Sobre \(title)")
                }
            }

            content()
        }
    }

    /// Linhas separadas por divisores dentro de um cartão arredondado.
    private func card<Item: Identifiable, Row: View>(
        _ items: [Item],
        @ViewBuilder row: @escaping (Item) -> Row
    ) -> some View {

        VStack(spacing: 0) {

            ForEach(items) { item in

                row(item)

                if item.id != items.last?.id {

                    Divider().padding(.leading, DesignSystem.Spacing.large)
                }
            }
        }
        .cardBackground()
    }
}

private extension View {

    func rowPadding() -> some View {
        padding(.horizontal, DesignSystem.Spacing.large)
            .padding(.vertical, DesignSystem.Spacing.medium)
            .frame(minHeight: DesignSystem.minimumTouchTarget)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
    }
}
