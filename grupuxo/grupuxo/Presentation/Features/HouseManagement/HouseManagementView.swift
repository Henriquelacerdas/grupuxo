import SwiftUI
import GrupuxoDomain

struct HouseManagementView: View {

    @StateObject private var viewModel: HouseManagementViewModel

    @State private var isPresentingTaskCreationSheet = false
    @State private var isPresentingRoomCreationSheet = false

    let makeTaskEditorViewModel: () -> TaskEditorViewModel
    let makeRoomEditorViewModel: () -> RoomEditorViewModel

    let onSelectRoom: (Room.ID) -> Void
    let onSelectSporadicTasks: () -> Void

    init(
        viewModel: HouseManagementViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        makeRoomEditorViewModel: @escaping () -> RoomEditorViewModel,
        onSelectRoom: @escaping (Room.ID) -> Void,
        onSelectSporadicTasks: @escaping () -> Void
    ) {

        _viewModel = StateObject(wrappedValue: viewModel)

        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.makeRoomEditorViewModel = makeRoomEditorViewModel

        self.onSelectRoom = onSelectRoom
        self.onSelectSporadicTasks = onSelectSporadicTasks
    }

    var body: some View {

        List {

            switch viewModel.state {

            case .idle, .loading:

                statusRow {
                    ProgressView("Carregando cômodos…")
                }

            case let .content(content):

                sporadicTasksRow(content.sporadic)

                roomsHeaderRow

                ForEach(content.rooms) { row in
                    roomRow(row)
                }

            case .empty:

                statusRow {
                    Text("Nenhum cômodo cadastrado.")
                        .foregroundStyle(.secondary)
                }

            case let .failure(message):

                statusRow {
                    Label(
                        message,
                        systemImage: "exclamationmark.triangle"
                    )
                    .foregroundStyle(.red)
                }
            }
        }
        .listStyle(.plain)
        .listRowSpacing(DesignSystem.Spacing.medium)
        .scrollContentBackground(.hidden)
        .background(Color(uiColor: .systemGroupedBackground))

        .navigationTitle("Casa")

        .toolbar {

            ToolbarItem(placement: .topBarTrailing) {

                Button(
                    "Adicionar tarefa",
                    systemImage: "plus"
                ) {
                    isPresentingTaskCreationSheet = true
                }
                .prominentToolbarButtonStyle()
                .accessibilityIdentifier("createTask")
            }

            ToolbarItem(placement: .topBarTrailing) {

                Button {
                    isPresentingRoomCreationSheet = true
                } label: {
                    Image(systemName: "rectangle.stack.badge.plus")
                }
                .accessibilityLabel("Adicionar cômodo")
                .accessibilityIdentifier("createRoom")
            }
        }

        .sheet(
            isPresented: $isPresentingTaskCreationSheet
        ) {

            TaskCreationSheetView(
                viewModel: makeTaskEditorViewModel()
            )
            .presentationDragIndicator(.visible)
        }

        .sheet(
            isPresented: $isPresentingRoomCreationSheet,
            onDismiss: {

                Task {
                    await viewModel.load()
                }
            }
        ) {

            RoomCreationSheetView(
                viewModel: makeRoomEditorViewModel(),
                existingRoomNames: existingRoomNames
            )
            .presentationDragIndicator(.hidden)
        }

        .alert(
            "Não foi possível concluir",
            isPresented: actionErrorBinding,
            presenting: viewModel.actionError
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }

        .task {
            await viewModel.load()
        }

        .refreshable {
            await viewModel.load()
        }
    }

    private func sporadicTasksRow(
        _ summary: SporadicSummary
    ) -> some View {

        SporadicTasksCard(
            summary: summary,
            onSelect: onSelectSporadicTasks
        )
        .plainCardRow()
    }

    private var roomsHeaderRow: some View {

        Text("Cômodos")
            .font(.title3.bold())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, DesignSystem.Spacing.small)
            .accessibilityAddTraits(.isHeader)
            .plainCardRow()
    }

    @ViewBuilder
    private func roomRow(
        _ row: RoomRow
    ) -> some View {

        switch row.access {

        case let .member(member):

            Button {
                onSelectRoom(row.id)
            } label: {
                RoomCard(row: row, member: member)
            }
            .buttonStyle(.plain)
            .plainCardRow()

        case let .restricted(requestPending):

            RestrictedRoomCard(
                row: row,
                requestPending: requestPending,
                onRequest: {
                    Task { await viewModel.requestAccess(to: row.id) }
                },
                onCancel: {
                    Task { await viewModel.cancelAccessRequest(for: row.id) }
                }
            )
            .plainCardRow()
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

    private var existingRoomNames: [String] {
        viewModel.roomNames
    }

    private var actionErrorBinding: Binding<Bool> {

        Binding(
            get: { viewModel.actionError != nil },
            set: { if !$0 { viewModel.actionError = nil } }
        )
    }
}

private extension View {

    @ViewBuilder
    func prominentToolbarButtonStyle() -> some View {

        if #available(iOS 26, *) {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent)
        }
    }

    /// A linha da lista vira só um espaço: o fundo e o arredondamento ficam no cartão.
    func plainCardRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(
                EdgeInsets(
                    top: 0,
                    leading: DesignSystem.Spacing.large,
                    bottom: 0,
                    trailing: DesignSystem.Spacing.large
                )
            )
    }
}
