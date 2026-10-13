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

    /// Destinos do menu "…"; enquanto forem nulos, os itens aparecem desabilitados.
    let onReorderRooms: (() -> Void)?
    let onOpenHouseSettings: (() -> Void)?

    init(
        viewModel: HouseManagementViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        makeRoomEditorViewModel: @escaping () -> RoomEditorViewModel,
        onSelectRoom: @escaping (Room.ID) -> Void,
        onSelectSporadicTasks: @escaping () -> Void,
        onReorderRooms: (() -> Void)? = nil,
        onOpenHouseSettings: (() -> Void)? = nil
    ) {

        _viewModel = StateObject(wrappedValue: viewModel)

        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.makeRoomEditorViewModel = makeRoomEditorViewModel

        self.onSelectRoom = onSelectRoom
        self.onSelectSporadicTasks = onSelectSporadicTasks
        self.onReorderRooms = onReorderRooms
        self.onOpenHouseSettings = onOpenHouseSettings
    }

    private var addMenu: some View {

        Menu {

            Button("Nova Tarefa", systemImage: "checklist") {
                isPresentingTaskCreationSheet = true
            }
            .accessibilityIdentifier("createTask")

            Button("Novo Cômodo", systemImage: "rectangle.inset.bottomright.filled") {
                isPresentingRoomCreationSheet = true
            }
            .accessibilityIdentifier("createRoom")

        } label: {
            Image(systemName: "plus")
        }
        .accessibilityLabel("Adicionar")
        .accessibilityIdentifier("addMenu")
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

            // Como o ✓ do Reordenar: o sistema deixa o botão da confirmação azul e redondo.
            ToolbarItem(placement: .confirmationAction) {
                addMenu
            }

            // Separa os dois botões em cápsulas de vidro distintas (iOS 26).
            if #available(iOS 26, *) {
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }

            ToolbarItem(placement: .topBarTrailing) {

                Menu {

                    Button {
                        onReorderRooms?()
                    } label: {
                        Label("Reordenar", systemImage: "line.3.horizontal")
                    }
                    .disabled(onReorderRooms == nil)

                    Button {
                        onOpenHouseSettings?()
                    } label: {
                        Label("Ajustes da Casa", systemImage: "gearshape")
                    }
                    .disabled(onOpenHouseSettings == nil)

                } label: {
                    Label("Mais opções", systemImage: "ellipsis")
                }
                .accessibilityIdentifier("houseMenu")
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
