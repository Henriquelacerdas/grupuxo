import SwiftUI
import GrupuxoDomain

struct MyTasksView: View {

    @StateObject private var viewModel: MyTasksViewModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var collapsedSections: Set<MyTasksSection> = []
    @State private var isPresentingTaskCreationSheet = false

    let makeTaskEditorViewModel: () -> TaskEditorViewModel

    let onRequestSwap: (TaskOccurrence.ID) -> Void
    let onSelectNotifications: () -> Void
    let onSelectProfile: () -> Void

    init(
        viewModel: MyTasksViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        onRequestSwap: @escaping (TaskOccurrence.ID) -> Void,
        onSelectNotifications: @escaping () -> Void,
        onSelectProfile: @escaping () -> Void
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.onRequestSwap = onRequestSwap
        self.onSelectNotifications = onSelectNotifications
        self.onSelectProfile = onSelectProfile
    }

    var body: some View {

        List {

            switch viewModel.state {

            case .idle, .loading:

                statusRow {
                    ProgressView("Carregando tarefas…")
                }

            case let .content(content):

                WeeklySummaryCard(
                    message: viewModel.weeklySummaryMessage,
                    onLater: {},
                    onRate: {}
                )
                .plainCardRow()

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
                    ResidentAvatar(user: viewModel.user)
                }
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

        .task {
            await viewModel.load()
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
            await viewModel.load()
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

            section(.extras) {

                ForEach(content.extras) { row in
                    taskRow(row)
                }
            }
        }

        if !content.sporadics.isEmpty {

            section(.sporadic) {

                ForEach(content.sporadics) { row in
                    taskRow(row)
                }
            }
        }
    }

    @ViewBuilder
    private func section<Rows: View>(
        _ section: MyTasksSection,
        @ViewBuilder rows: () -> Rows
    ) -> some View {

        let isExpanded = !collapsedSections.contains(section)

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
        .swipeActions(edge: .trailing) {

            if viewModel.canRequestSwap(row.item) {

                Button {
                    onRequestSwap(row.id)
                } label: {
                    Label(
                        "Solicitar troca",
                        systemImage: "arrow.left.arrow.right"
                    )
                }
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
