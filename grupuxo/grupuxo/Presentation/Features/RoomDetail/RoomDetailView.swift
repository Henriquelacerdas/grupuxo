import SwiftUI

import GrupuxoDomain

/// Tela de um cômodo: quem está com o rodízio, as tarefas ("Agora" ou "Todas") e, em "Todas", as sugestões.
struct RoomDetailView: View {

    @Environment(\.dismiss) private var dismiss

    @StateObject private var viewModel: RoomDetailViewModel

    @State private var selectedSuggestion: TaskSuggestion?

    @State private var taskToEnd: TaskDefinition?

    @State private var isPresentingTaskCreationSheet = false
    @State private var confirmsLeave = false

    @State private var showsCycleDetails = false

    @State private var taskFilter: RoomTaskFilter = .now

    private let makeTaskEditorViewModel: () -> TaskEditorViewModel

    private let makeSuggestionEditorViewModel: (TaskSuggestion) -> TaskEditorViewModel

    private let onSelectTask: (TaskDefinition.ID) -> Void
    private let reloadTrigger: AnyHashable

    init(
        viewModel: RoomDetailViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        makeSuggestionEditorViewModel: @escaping (TaskSuggestion) -> TaskEditorViewModel,
        onSelectTask: @escaping (TaskDefinition.ID) -> Void,
        reloadTrigger: AnyHashable = 0
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.makeSuggestionEditorViewModel = makeSuggestionEditorViewModel
        self.onSelectTask = onSelectTask
        self.reloadTrigger = reloadTrigger
    }

    private var room: Room? { viewModel.participation?.room }

    private var isMember: Bool { viewModel.participation?.isMember == true }

    var body: some View {

        List {

            if let info = viewModel.participation {

                cycleCard(info)

                if !info.isMember {
                    joinSection
                }
            }

            if isMember {
                filterPicker
            }

            switch viewModel.state {

            case .idle, .loading:
                ProgressView("Carregando cômodo…")
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)

            case let .content(content):
                tasks(RoomDetailSections(content: content, filter: taskFilter, now: .now))

            case .empty:
                tasks(nil)

            case let .failure(message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }

            if isMember, taskFilter == .all, !viewModel.suggestions.isEmpty {
                suggestionsSection
            }
        }
        .listSectionSpacing(.compact)
        .navigationTitle(room?.name ?? String(localized: "Cômodo"))
        .navigationBarTitleDisplayMode(.large)
        .roomSubtitle(room.map { RoomDetailText.rotation($0.periodicity) })
        .scrollContentBackground(.hidden)
        .background { background }
        .toolbar { toolbar }
        .sheet(
            isPresented: $isPresentingTaskCreationSheet,
            onDismiss: { Task { await viewModel.load() } }
        ) {
            TaskCreationSheetView(viewModel: makeTaskEditorViewModel())
                .presentationDragIndicator(.visible)
        }
        .sheet(
            item: $selectedSuggestion,
            onDismiss: { Task { await viewModel.load() } }
        ) { suggestion in
            TaskCreationSheetView(viewModel: makeSuggestionEditorViewModel(suggestion))
                .presentationDragIndicator(.hidden)
        }
        .task(id: reloadTrigger) {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load(forceRefresh: true)
        }
        .onChange(of: viewModel.wasDeleted) { _, deleted in
            if deleted { dismiss() }
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
            leaveTitle,
            isPresented: $confirmsLeave
        ) {
            Button("Cancelar", role: .cancel) {}
            Button("Sair", role: .destructive) {
                Task { await viewModel.leave() }
            }
        } message: {
            Text("Você continua com as tarefas desta semana até domingo. Depois, o rodízio segue só entre os outros.")
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

    private var leaveTitle: String {
        guard let room else { return String(localized: "Sair do rodízio?") }
        return String(localized: "Sair do rodízio de “\(room.name)”?")
    }

    // MARK: - Rodízio

    /// "⇄ Você e Henrique L. / Termina domingo"; tocado, abre um segundo cartão com ciclo, quem está agora e participantes.
    @ViewBuilder
    private func cycleCard(_ info: RoomParticipation) -> some View {

        Section {

            Button {
                withAnimation(.easeInOut) { showsCycleDetails.toggle() }
            } label: {
                HStack(spacing: DesignSystem.Spacing.medium) {

                    Image(systemName: "repeat")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(info.room.color.tint)
                        .frame(minWidth: DesignSystem.minimumTouchTarget)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

                        Text(viewModel.responsiblesSummary ?? allResidentsText(info.room))
                            .font(.headline)
                            .foregroundStyle(.primary)

                        if let deadline = viewModel.deadlineSummary {
                            Text(deadline)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(info.room.color.tint)
                        .rotationEffect(.degrees(showsCycleDetails ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(showsCycleDetails ? Text("Expandido") : Text("Recolhido"))
            .accessibilityHint("Mostra os detalhes do rodízio")
        }

        if showsCycleDetails {

            Section {

                if let duration = viewModel.cycleDurationSummary {
                    detailRow("Ciclo", systemImage: "repeat", value: duration)
                }

                if let responsibles = viewModel.responsiblesSummary {
                    detailRow("Agora", systemImage: "person.crop.circle.badge.checkmark", value: responsibles)
                }

                detailRow(
                    "Participantes",
                    systemImage: "person.2.fill",
                    value: info.room.visibility == .common
                        ? RoomDetailText.people(info.memberCount)
                        : viewModel.participantsSummary ?? RoomDetailText.people(info.memberCount)
                )
            }
        }
    }

    private func allResidentsText(_ room: Room) -> String {
        room.visibility == .common
            ? String(localized: "Todos os moradores")
            : String(localized: "Cômodo privado")
    }

    private func detailRow(_ title: LocalizedStringKey, systemImage: String, value: String) -> some View {
        LabeledContent {
            Text(value)
        } label: {
            Label {
                Text(title)
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(.tint)
            }
        }
    }

    private var joinSection: some View {
        Section {
            Text("Entre para consultar e criar tarefas neste cômodo.")
                .foregroundStyle(.secondary)

            Button("Entrar no cômodo") {
                Task { await viewModel.join() }
            }
            .disabled(viewModel.isChangingMembership)
        }
    }

    private var filterPicker: some View {
        Section {
            Picker("Exibição de tarefas", selection: $taskFilter) {
                ForEach(RoomTaskFilter.allCases, id: \.self) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    // MARK: - Tarefas

    @ViewBuilder
    private func tasks(_ sections: RoomDetailSections?) -> some View {

        let cycle = sections?.cycle ?? []
        let general = sections?.general ?? []
        let single = viewModel.sporadicTasks.filter {
            taskFilter == .all || $0.occurrence.availableAt <= .now
        }

        if cycle.isEmpty, general.isEmpty, single.isEmpty {
            Section {
                EmptyStateView(
                    title: "Nenhuma tarefa aqui",
                    systemImage: "checklist",
                    description: "Adicione a primeira em “+” ou escolha uma sugestão na aba Todas."
                )
            }
            .listRowBackground(Color.clear)
        } else {
            if !cycle.isEmpty {
                taskSection("Repetição do cômodo", tasks: cycle, kind: .cycle)
            }
            if !general.isEmpty {
                taskSection("Repetição própria", tasks: general, kind: .general)
            }
            if !single.isEmpty {
                taskSection("Tarefas únicas", tasks: single, kind: .single)
            }
        }
    }

    private enum SectionKind {
        case cycle, general, single
    }

    private func taskSection(
        _ title: LocalizedStringKey,
        tasks: [TaskItem],
        kind: SectionKind
    ) -> some View {

        Section {
            ForEach(tasks) { item in
                row(item, kind: kind)
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        if kind != .single && viewModel.canComplete(item) {
                            Button {
                                Task { await viewModel.complete(item.id) }
                            } label: {
                                Label(
                                    item.occurrence.isCompleted ? "Reabrir" : "Concluir",
                                    systemImage: "checkmark"
                                )
                            }
                            .tint(.green)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if kind != .single && item.definition.endedAt == nil && isMember {
                            Button(role: .destructive) {
                                taskToEnd = item.definition
                            } label: {
                                Label("Encerrar", systemImage: "stop.circle")
                            }
                        }
                    }
            }
        } header: {
            Text(title)
                .roomSectionHeader()
        }
    }

    @ViewBuilder
    private func row(_ item: TaskItem, kind: SectionKind) -> some View {

        let select = { onSelectTask(item.definition.id) }

        switch (kind, taskFilter) {

        case (.single, _):
            RoomUniqueTaskRow(
                item: item,
                currentUserID: viewModel.currentUserID,
                onSelect: select,
                onClaim: viewModel.canClaim(item) ? {
                    Task { await viewModel.claim(item.id) }
                } : nil
            )

        case (.cycle, .now):
            RoomCycleTaskRow(item: item, currentUserID: viewModel.currentUserID, onSelect: select)

        case (.general, .now):
            RoomCycleTaskRow(
                item: item,
                currentUserID: viewModel.currentUserID,
                timing: viewModel.timing(of: item),
                onSelect: select
            )

        case (.cycle, .all):
            RoomCycleAllTaskRow(item: item, onSelect: select)

        case (.general, .all):
            RoomGeneralTaskRow(item: item, onSelect: select)
        }
    }

    // MARK: - Sugestões

    private var suggestionsSection: some View {

        Section {
            ForEach(viewModel.visibleSuggestions) { suggestion in
                Button {
                    selectedSuggestion = suggestion
                } label: {
                    HStack(spacing: DesignSystem.Spacing.medium) {
                        VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                            Text(suggestion.name)
                                .font(.body)
                                .foregroundStyle(.primary)
                            Text(RoomDetailText.effort(suggestion.effort))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: DesignSystem.Spacing.small)

                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                    }
                    .roomTaskRowFrame()
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint("Abre o formulário para adicionar a tarefa sugerida")
            }

            if viewModel.hasOtherSuggestions {
                Button("Outras sugestões", systemImage: "arrow.clockwise") {
                    viewModel.showOtherSuggestions()
                }
                .frame(maxWidth: .infinity)
            }
        } header: {
            Text("Sugestões de tarefas")
                .roomSectionHeader()
        }
    }

    // MARK: - Barra e fundo

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {

        if isMember {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Nova tarefa", systemImage: "plus") {
                    isPresentingTaskCreationSheet = true
                }
            }
        }

        // "Casa toda" não admite saída individual.
        if let room, isMember, !room.representsWholeHouse {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Sair do rodízio", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                        confirmsLeave = true
                    }
                    .disabled(viewModel.isChangingMembership)
                } label: {
                    Label("Mais opções do cômodo", systemImage: "ellipsis")
                }
            }
        }
    }

    /// Faixa na cor do cômodo no topo, sumindo no fundo agrupado.
    private var background: some View {
        ZStack(alignment: .top) {
            Color(uiColor: .systemGroupedBackground)
                .ignoresSafeArea()

            if let room {
                LinearGradient(
                    colors: [room.color.tint.opacity(0.75), Color(uiColor: .systemGroupedBackground).opacity(0)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .containerRelativeFrame(.vertical) { height, _ in height / 3 }
                .ignoresSafeArea(edges: .top)
            }
        }
    }
}

private extension View {

    /// Títulos das seções do cômodo, no tamanho dos títulos de seção de Minhas tarefas.
    func roomSectionHeader() -> some View {
        font(.title2.bold())
            .foregroundStyle(Color.primary)
            .textCase(nil)
            // Alinha o título à borda do cartão, como no design (o cabeçalho da lista vem recuado).
            .padding(.leading, -DesignSystem.Spacing.large)
    }

    /// Subtítulo do título grande (iOS 26): "Rodízio semanal"; antes disso a tela fica só com o título.
    @ViewBuilder
    func roomSubtitle(_ subtitle: String?) -> some View {
        if #available(iOS 26, *), let subtitle {
            navigationSubtitle(subtitle)
        } else {
            self
        }
    }
}
