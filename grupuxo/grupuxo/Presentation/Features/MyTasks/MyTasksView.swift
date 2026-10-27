import SwiftUI
import GrupuxoDomain

struct MyTasksView: View {

    @StateObject private var viewModel: MyTasksViewModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.showToast) private var showToast

    @State private var collapsedSections: Set<MyTasksSection> = []
    @State private var isPresentingTaskCreationSheet = false
    @State private var taskToEnd: TaskDefinition?

    let makeTaskEditorViewModel: () -> TaskEditorViewModel

    let onRequestSwap: (TaskOccurrence.ID) -> Void
    let onSelectTask: (TaskDefinition.ID) -> Void
    let onSelectNotifications: () -> Void
    let onSelectProfile: () -> Void
    /// Muda quando a aba volta a ficar ativa, forçando um novo carregamento.
    let reloadTrigger: AnyHashable

    init(
        viewModel: MyTasksViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        onRequestSwap: @escaping (TaskOccurrence.ID) -> Void,
        onSelectTask: @escaping (TaskDefinition.ID) -> Void,
        onSelectNotifications: @escaping () -> Void,
        onSelectProfile: @escaping () -> Void,
        reloadTrigger: AnyHashable = 0
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.onRequestSwap = onRequestSwap
        self.onSelectTask = onSelectTask
        self.onSelectNotifications = onSelectNotifications
        self.onSelectProfile = onSelectProfile
        self.reloadTrigger = reloadTrigger
    }

    var body: some View {

        List {

            switch viewModel.state {

            case .idle, .loading:

                statusRow {
                    ProgressView("Carregando tarefas…")
                }

            case let .content(content):

                sections(for: content)

            case .empty:

                statusRow {
                    EmptyStateView(
                        title: "Nenhuma tarefa",
                        systemImage: "checklist"
                    )
                }

            case let .failure(message):

                statusRow {
                    ContentUnavailableView(
                        "Não foi possível carregar",
                        systemImage: "exclamationmark.triangle",
                        description: Text(message)
                    )
                }
            }
        }
        .listStyle(.plain)
        .listRowSpacing(0)

        .navigationTitle("Minhas tarefas")

        .toolbar {

            ToolbarItem(placement: .topBarLeading) {

                Button(action: onSelectProfile) {
                    ResidentAvatar(user: viewModel.user, size: .toolbar)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Perfil")
                .accessibilityIdentifier("profile")
            }

            ToolbarItemGroup(placement: .topBarTrailing) {

                Button(
                    "Notificações",
                    systemImage: "bell",
                    action: onSelectNotifications
                )
                .accessibilityIdentifier("notifications")

                Button(
                    "Adicionar tarefa",
                    systemImage: "plus"
                ) {
                    isPresentingTaskCreationSheet = true
                }
                .prominentToolbarButtonStyle()
                .accessibilityIdentifier("createTask")
            }
        }

        .sheet(
            isPresented: $isPresentingTaskCreationSheet,
            onDismiss: {

                Task {
                    await viewModel.load(showLoading: false)
                }
            }
        ) {

            TaskCreationSheetView(
                viewModel: makeTaskEditorViewModel()
            )
            .presentationDragIndicator(.visible)
        }

        .task(id: reloadTrigger) {
            if case .idle = viewModel.state {
                await viewModel.load()
            } else {
                await viewModel.load(showLoading: false)
            }
        }

        .alert(
            "Excluir tarefa?",
            isPresented: Binding(
                get: { taskToEnd != nil },
                set: { if !$0 { taskToEnd = nil } }
            ),
            presenting: taskToEnd
        ) { task in
            Button("Cancelar", role: .cancel) {}
            Button("Excluir", role: .destructive) {
                Task {
                    if await viewModel.end(taskID: task.id) {
                        showToast(.deleted(String(localized: "Tarefa excluída")))
                    }
                }
            }
        } message: { task in
            Text("\(task.name) não será mais repetida. O histórico fica, e a vez atual continua até ser concluída.")
        }

        .onChange(of: viewModel.actionError) { _, error in
            if error != nil { Haptics.error() }
        }
        .alert(
            "Não foi possível atualizar a tarefa",
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.actionError = nil } }
            )
        ) {
            Button("OK") {
                viewModel.actionError = nil
            }
        } message: {
            Text(viewModel.actionError ?? "")
        }

        .refreshable {
            await viewModel.load(forceRefresh: true)
        }
    }

    // MARK: - Seções

    @ViewBuilder
    private func sections(
        for content: MyTasksContent
    ) -> some View {

        if !content.cycles.isEmpty {

            section(.cycle) {

                ForEach(content.cycles) { cycle in

                    CycleRoomHeader(cycle: cycle)
                        .plainCardRow()

                    ForEach(cycle.rows) { row in
                        taskRow(row)
                    }
                }
            }
        }

        if !content.extras.isEmpty {

            section(.extras, showsDivider: !content.cycles.isEmpty) {

                ForEach(content.extras) { row in
                    taskRow(row)
                }
            }
        }

        if !content.sporadics.isEmpty {

            section(
                .sporadic,
                showsDivider: !content.cycles.isEmpty || !content.extras.isEmpty
            ) {

                ForEach(content.sporadics) { row in
                    taskRow(row)
                }
            }
        }
    }

    @ViewBuilder
    /// Seção recolhível; `showsDivider` separa da seção anterior com uma linha, como no design.
    private func section<Rows: View>(
        _ section: MyTasksSection,
        showsDivider: Bool = false,
        @ViewBuilder rows: () -> Rows
    ) -> some View {

        let isExpanded = !collapsedSections.contains(section)

        VStack(spacing: DesignSystem.Spacing.large) {

            if showsDivider {
                Divider()
            }

            CollapsibleSectionHeader(
                title: section.title,
                isExpanded: isExpanded
            ) {
                withAnimation(reduceMotion ? nil : .default) {
                    if isExpanded {
                        collapsedSections.insert(section)
                    } else {
                        collapsedSections.remove(section)
                    }
                }
            }
        }
        .padding(.top, DesignSystem.Spacing.large)
        .plainCardRow()

        if isExpanded {
            rows()
        }
    }

    private func taskRow(
        _ row: MyTasksContent.Row
    ) -> some View {

        MyTaskRow(
            row: row,
            canComplete: viewModel.canComplete(row.item)
        ) {
            Task {
                await viewModel.complete(row.id)
            }
        }
        .plainCardRow()
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {

            if viewModel.canEnd(row.item) {

                Button(role: .destructive) {
                    taskToEnd = row.item.definition
                } label: {
                    Label(
                        "Excluir",
                        systemImage: "trash"
                    )
                }
            }

            Button {
                onSelectTask(row.item.definition.id)
            } label: {
                Label(
                    "Editar",
                    systemImage: "pencil"
                )
            }
            .tint(.gray)

            if viewModel.canRequestSwap(row.item) {

                Button {
                    onRequestSwap(row.id)
                } label: {
                    Label(
                        "Pedir troca",
                        systemImage: "arrow.left.arrow.right"
                    )
                }
                .tint(.accentColor)
            }
        }
    }

    private func statusRow<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {

        HStack {

            Spacer()

            content()

            Spacer()
        }
        .plainCardRow()
    }
}
