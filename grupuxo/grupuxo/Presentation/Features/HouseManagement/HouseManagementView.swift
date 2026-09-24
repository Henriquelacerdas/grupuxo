import SwiftUI

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

            Section {

                Button(action: onSelectSporadicTasks) {

                    HStack(spacing: DesignSystem.contentSpacing) {

                        Image(systemName: "sparkles")
                            .font(.title2)
                            .foregroundStyle(.tint)

                        VStack(
                            alignment: .leading,
                            spacing: DesignSystem.Spacing.extraSmall
                        ) {

                            Text("Tarefas esporádicas")
                                .font(.headline)

                            Text("Veja tarefas disponíveis para assumir")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, DesignSystem.Spacing.small)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Abrir tarefas esporádicas")
            }

            Section("Cômodos") {
                roomsContent
            }
        }
        .navigationTitle("Casa")

        .toolbar {

            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    isPresentingRoomCreationSheet = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .accessibilityLabel("Adicionar cômodo")
                .accessibilityIdentifier("createRoom")

                Button("Adicionar tarefa", systemImage: "plus") {
                    isPresentingTaskCreationSheet = true
                }
                .accessibilityIdentifier("createTask")
            }
        }

        .sheet(
            isPresented: $isPresentingTaskCreationSheet
        ) {

            TaskCreationSheetView(
                viewModel: makeTaskEditorViewModel()
            )
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
                viewModel: makeRoomEditorViewModel()
            )
        }

        .task {

            await viewModel.load()
        }

        .refreshable {
            await viewModel.load()
        }
    }

    @ViewBuilder
    private var roomsContent: some View {

        switch viewModel.state {

        case .idle, .loading:

            HStack {

                Spacer()

                ProgressView("Carregando cômodos…")

                Spacer()
            }

        case let .content(rooms):

            ForEach(rooms) { room in

                Button {
                    onSelectRoom(room.id)
                } label: {
                    HStack(spacing: DesignSystem.contentSpacing) {
                        RoomIconView(appearance: room.appearance ?? RoomAppearance(), size: 40)
                        Text(room.name)
                            .foregroundStyle(.primary)
                    }
                }
                .accessibilityLabel(room.name)
            }

        case .empty:

            Text("Nenhum cômodo cadastrado.")
                .foregroundStyle(.secondary)

        case let .failure(message):

            Label(
                message,
                systemImage: "exclamationmark.triangle"
            )
            .foregroundStyle(.red)
        }
    }
}
