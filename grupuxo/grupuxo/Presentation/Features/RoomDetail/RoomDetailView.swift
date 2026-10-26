import SwiftUI

import GrupuxoDomain

struct RoomDetailView: View {

    @Environment(\.dismiss) private var dismiss

    @StateObject private var viewModel: RoomDetailViewModel

    @State private var selectedSuggestion: TaskSuggestion?

    @State private var taskToEnd: TaskDefinition?

    @State private var isPresentingTaskCreationSheet = false

    @State private var showsTaskExplanation = false
    @State private var showsCycleDetails = false

    @State private var taskFilter: TaskFilter = .now
    @State private var suggestionOffset = 0

    private enum TaskFilter: String, CaseIterable, Identifiable {
        case now = "Agora"
        case all = "Todas"

        var id: Self { self }
    }

    private let makeTaskEditorViewModel: () -> TaskEditorViewModel

    private let makeSuggestionEditorViewModel: (TaskSuggestion) -> TaskEditorViewModel

    private let onSelectTask: (TaskDefinition.ID) -> Void

    init(

        viewModel: RoomDetailViewModel,

        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,

        makeSuggestionEditorViewModel: @escaping (TaskSuggestion) -> TaskEditorViewModel,

        onSelectTask: @escaping (TaskDefinition.ID) -> Void

    ) {

        _viewModel = StateObject(

            wrappedValue: viewModel

        )

        self.makeTaskEditorViewModel = makeTaskEditorViewModel

        self.makeSuggestionEditorViewModel =

            makeSuggestionEditorViewModel

        self.onSelectTask = onSelectTask

    }

    var body: some View {

        List {

            if let info = viewModel.participation {

                Section {
                    VStack(spacing: 0) {
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                showsCycleDetails.toggle()
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "repeat")
                                    .font(.system(size: 22, weight: .medium))
                                    .foregroundStyle(info.room.color.tint)
                                    .frame(width: 44)
                                    .accessibilityHidden(true)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(
                                        viewModel.responsiblesSummary
                                            ?? (info.room.visibility == .common
                                                ? "Todos os moradores"
                                                : "Cômodo privado")
                                    )
                                        .font(.system(size: 17, weight: .bold))
                                        .foregroundStyle(.primary)
                                    Text(HouseOverviewText().deadline(cycleEnd: info.periodEnd, now: .now))
                                        .font(.system(size: 15))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(info.room.color.tint)
                                    .rotationEffect(.degrees(showsCycleDetails ? 180 : 0))
                            }
                            .padding(.horizontal, 16)
                            .frame(height: 68)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Detalhes do ciclo")
                        .accessibilityValue(showsCycleDetails ? "Expandido" : "Recolhido")

                        if showsCycleDetails {
                            Divider()
                            HStack {
                                Text("Duração do ciclo")
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text(cycleDurationLabel(info.room))
                                    .foregroundStyle(.secondary)
                            }
                            .font(.system(size: 17))
                            .padding(.horizontal, 16)
                            .frame(height: 52)
                            Divider()
                            HStack {
                                Text("Participantes")
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text(info.room.visibility == .common ? "Todos - público" : "Privado")
                                    .foregroundStyle(.secondary)
                            }
                            .font(.system(size: 17))
                            .padding(.horizontal, 16)
                            .frame(height: 52)
                        }
                    }
                    .background(
                        Color(uiColor: .secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 26, style: .continuous)
                    )
                    .padding(.top, 20)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                if !info.isMember {

                    Section {

                        Text("Entre para consultar e criar tarefas neste cômodo.")

                            .foregroundStyle(.secondary)

                        Button("Entrar no cômodo") {

                            Task { await viewModel.join() }

                        }

                        .disabled(viewModel.isChangingMembership)

                    }

                }

            }

            if viewModel.participation?.isMember == true {
                Section {
                    Picker("Exibição de tarefas", selection: $taskFilter) {
                        ForEach(TaskFilter.allCases) { filter in
                            Text(filter.rawValue).tag(filter)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(height: 32)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 12, leading: 0, bottom: 0, trailing: 0))
            }

            switch viewModel.state {

            case .idle, .loading:

                ProgressView(

                    "Carregando cômodo…"

                )

            case let .content(content):
                taskSection(
                    "Tarefas do ciclo",
                    tasks: visibleTasks(content.tasks.filter(isCycleTask)),
                    includesInfo: true
                )

                taskSection(
                    "Tarefas gerais",
                    tasks: visibleTasks(content.tasks.filter { !isCycleTask($0) })
                )
                taskSection(
                    "Tarefas únicas",
                    tasks: visibleTasks(viewModel.sporadicTasks),
                    isSporadic: true
                )

            case .empty:
                taskSection("Tarefas do ciclo", tasks: [], includesInfo: true)
                taskSection("Tarefas gerais", tasks: [])
                taskSection("Tarefas únicas", tasks: visibleTasks(viewModel.sporadicTasks), isSporadic: true)

            case let .failure(message):

                Text(

                    message

                )

            }

            if !viewModel.suggestions.isEmpty {

                Section {
                    ForEach(visibleSuggestions) { suggestion in
                        Button {
                            selectedSuggestion = suggestion
                        } label: {
                            suggestionRow(suggestion)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(
                            EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16)
                        )
                    }

                    Button {
                        let count = viewModel.suggestions.count
                        guard count > 1 else { return }
                        // Avança três sugestões quando houver mais de três;
                        // com um catálogo menor, alterna a ordem dos itens disponíveis.
                        let step = count > 3 ? 3 : 1
                        suggestionOffset = (suggestionOffset + step) % count
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 17, weight: .regular))
                            Text("Outras sugestões")
                                .font(.system(size: 17, weight: .regular))
                                .tracking(-0.43)
                        }
                        .foregroundStyle(Color(uiColor: .systemBlue))
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.suggestions.count < 2)
                    .accessibilityHint(
                        viewModel.suggestions.count > 3
                        ? "Exibe outras sugestões disponíveis"
                        : "Alterna as sugestões disponíveis"
                    )
                    .listRowInsets(
                        EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16)
                    )

                } header: {
                    Text("Sugestões de tarefas")
                        .font(.system(size: 22, weight: .bold))
                        .tracking(-0.26)
                        .textCase(nil)
                        .foregroundColor(Color(uiColor: .label))
                }
            }

        }

        .listSectionSpacing(.custom(0))
        .navigationTitle(viewModel.participation?.room.name ?? "Cômodo")

        .navigationBarTitleDisplayMode(.large)

        .scrollContentBackground(.hidden)

         .background {
            ZStack(alignment: .top) {
                Color(uiColor: .systemGroupedBackground)
                if let room = viewModel.participation?.room {
                    LinearGradient(
                        colors: [room.color.tint.opacity(0.75), Color(uiColor: .systemGroupedBackground).opacity(0)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 247)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea(edges: .top)
                }
            }
        }

        .toolbar {

            ToolbarItem(placement: .topBarTrailing) {

                if viewModel.participation?.isMember == true {

                    Button {

                        isPresentingTaskCreationSheet = true

                    } label: {

                        Image(systemName: "plus")

                    }

                    .accessibilityLabel("Nova tarefa")

                }

            }

            if let info = viewModel.participation,
               info.isMember && !info.room.representsWholeHouse {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Sair do cômodo", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            Task { await viewModel.leave() }
                        }
                        .disabled(viewModel.isChangingMembership)
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("Mais opções do cômodo")
                }
            }
        }

        .sheet(

            isPresented: $isPresentingTaskCreationSheet,

            onDismiss: {

                Task { await viewModel.load() }

            }

        ) {

            TaskCreationSheetView(viewModel: makeTaskEditorViewModel())

                .presentationDragIndicator(.visible)

        }

        .task {

            await viewModel.load()

        }

        .refreshable {

            await viewModel.load()

        }

        .sheet(

            item: $selectedSuggestion,

            onDismiss: {

                Task {

                    await viewModel.load()

                }

            }

        ) { suggestion in

            TaskCreationSheetView(

                viewModel:

                    makeSuggestionEditorViewModel(

                        suggestion

                    )

            )

            .presentationDragIndicator(

                .hidden

            )

        }

        .onChange(

            of: viewModel.wasDeleted

        ) { _, deleted in

            if deleted {

                dismiss()

            }

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

            isPresented:

                $viewModel.confirmsDeletion

        ) {

            Button(

                "Cancelar",

                role: .cancel

            ) {}

            Button(

                "Sair e excluir",

                role: .destructive

            ) {

                Task {

                    await viewModel.leave(

                        confirmDeletion: true

                    )

                }

            }

        } message: {

            Text(

                "Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos."

            )

        }

        .alert(

            "Não foi possível realizar a ação",

            isPresented: Binding(

                get: {

                    viewModel.actionError != nil

                },

                set: {

                    if !$0 {

                        viewModel.actionError = nil

                    }

                }

            )

        ) {

            Button(

                "OK"

            ) {

                viewModel.actionError = nil

            }

        } message: {

            Text(

                viewModel.actionError ?? ""

            )

        }

    }

    private func cycleDurationLabel(_ room: Room) -> String {
        room.periodicity.executionsPerPeriod == 1 && room.periodicity.intervalWeeks == 1
            ? "Semanal" : room.periodicity.label
    }

    // Tarefas do ciclo usam a periodicidade do cômodo; recorrências próprias
    // são listadas em "Tarefas gerais". Confirmar esta regra com o domínio.
    private func isCycleTask(_ item: TaskItem) -> Bool {
        if case .weekly = item.definition.recurrence { return true }
        return false
    }

    @ViewBuilder
    private func taskSection(
        _ title: String,
        tasks: [TaskItem],
        includesInfo: Bool = false,
        isSporadic: Bool = false
    ) -> some View {
        Section {
            if tasks.isEmpty {
                Text("Nenhuma tarefa nesta seção.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(tasks) { item in
                    Group {
                        if isSporadic {
                            RoomUniqueTaskRow(
                                item: item,
                                onSelect: { onSelectTask(item.definition.id) },
                                onClaim: viewModel.canClaim(item) ? {
                                    Task { await viewModel.claim(item.id) }
                                } : nil
                            )
                        } else if taskFilter == .now {
                            RoomCycleTaskRow(item: item) {
                                onSelectTask(item.definition.id)
                            }
                        } else if includesInfo {
                            RoomCycleAllTaskRow(item: item) {
                                onSelectTask(item.definition.id)
                            }
                        } else {
                            RoomGeneralTaskRow(item: item) {
                                onSelectTask(item.definition.id)
                            }
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .listRowSeparator(.hidden)
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        if !isSporadic && viewModel.canComplete(item) {
                            Button {
                                Task { await viewModel.complete(item.id) }
                            } label: {
                                Label(item.occurrence.isCompleted ? "Reabrir" : "Concluir",
                                      systemImage: "checkmark")
                            }
                            .tint(.green)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if !isSporadic && item.definition.endedAt == nil
                            && viewModel.participation?.isMember == true {
                            Button(role: .destructive) {
                                taskToEnd = item.definition
                            } label: {
                                Label("Encerrar", systemImage: "stop.circle")
                            }
                        }
                    }
                }
            }
        } header: {
            HStack(spacing: 12) {
                Text(title)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Color(uiColor: .label))
                    .textCase(nil)
                if includesInfo {
                    Button {
                        showsTaskExplanation = true
                    } label: {
                        Image(systemName: "info.circle")
                            .font(.system(size: 17))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                    .popover(isPresented: $showsTaskExplanation) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Por que ficam separadas?")
                                .font(.headline)
                            Text("As do ciclo repetem junto com o cômodo e mudam de pessoa a cada ciclo.\nAs gerais têm repetição própria e só mudam de pessoa depois de feitas.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(16)
                        .frame(width: 290, alignment: .leading)
                        .presentationCompactAdaptation(.popover)
                    }
                }
            }
        }
    }

    private func visibleTasks(_ tasks: [TaskItem]) -> [TaskItem] {
        switch taskFilter {
        case .all:
            return tasks
        case .now:
            return tasks.filter { $0.occurrence.availableAt <= .now }
        }
    }

    private var visibleSuggestions: [TaskSuggestion] {
        let suggestions = viewModel.suggestions
        guard !suggestions.isEmpty else { return [] }
        let count = min(3, suggestions.count)
        let start = suggestionOffset % suggestions.count
        return (0..<count).map { offset in
            suggestions[(start + offset) % suggestions.count]
        }
    }

    private func suggestionRow(_ suggestion: TaskSuggestion) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(suggestion.name)
                    .font(.system(size: 17, weight: .regular))
                    .tracking(-0.43)
                    .foregroundStyle(.primary)
                Text(effortName(suggestion.effort.points))
                    .font(.system(size: 15, weight: .regular))
                    .tracking(-0.23)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Image(systemName: "plus.circle.fill")
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(Color(uiColor: .systemBlue))
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)
        }
        .frame(height: 68)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre o formulário para adicionar a tarefa sugerida")
    }

    private func effortName(

        _ points: Int

    ) -> String {

        switch points {

        case 1:

            "Fácil"

        case 2:

            "Médio"

        default:

            "Difícil"

        }

    }

}
