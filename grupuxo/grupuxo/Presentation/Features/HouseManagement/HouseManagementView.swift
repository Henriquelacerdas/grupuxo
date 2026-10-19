import SwiftUI
import GrupuxoDomain

struct HouseManagementView: View {

    @StateObject private var viewModel: HouseManagementViewModel

    @State private var isPresentingTaskCreationSheet = false
    @State private var isPresentingRoomCreationSheet = false
    @State private var isPresentingReorderSheet = false
    @State private var orderedRoomIDs: [Room.ID] = []

    let makeTaskEditorViewModel: () -> TaskEditorViewModel
    let makeRoomEditorViewModel: () -> RoomEditorViewModel

    let onSelectRoom: (Room.ID) -> Void
    let onSelectSporadicTasks: (() -> Void)?
    let onOpenHouseSettings: (() -> Void)?

    init(
        viewModel: HouseManagementViewModel,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        makeRoomEditorViewModel: @escaping () -> RoomEditorViewModel,
        onSelectRoom: @escaping (Room.ID) -> Void,
        onSelectSporadicTasks: (() -> Void)?,
        onOpenHouseSettings: (() -> Void)? = nil
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)

        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.makeRoomEditorViewModel = makeRoomEditorViewModel

        self.onSelectRoom = onSelectRoom
        self.onSelectSporadicTasks = onSelectSporadicTasks
        self.onOpenHouseSettings = onOpenHouseSettings
    }

    private var addMenu: some View {
        Menu {
            Button(
                "Nova Tarefa",
                systemImage: "checklist"
            ) {
                isPresentingTaskCreationSheet = true
            }
            .accessibilityIdentifier("createTask")

            Button(
                "Novo Cômodo",
                systemImage: "square.split.bottomrightquarter"
            ) {
                isPresentingRoomCreationSheet = true
            }
            .accessibilityIdentifier("createRoom")
        } label: {
            Image(systemName: "plus")
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.circle)
        .tint(.accentColor)
        .accessibilityLabel("Adicionar")
        .accessibilityIdentifier("addMenu")
    }

    var body: some View {

        List {

            if let onSelectSporadicTasks {

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
            }

            Section("Cômodos") {
                roomsContent
            }
        }
        .navigationTitle("Casa")
        .toolbar {

            ToolbarItem(placement: .topBarTrailing) {
                addMenu
            }

            if #available(iOS 26, *) {
                ToolbarSpacer(
                    .fixed,
                    placement: .topBarTrailing
                )
            }

            ToolbarItem(placement: .topBarTrailing) {

                Menu {

                    Button(
                        "Reordenar",
                        systemImage: "line.3.horizontal"
                    ) {
                        isPresentingReorderSheet = true
                    }

                    Button(
                        "Ajustes da Casa",
                        systemImage: "gear"
                    ) {
                        onOpenHouseSettings?()
                    }
                    .disabled(onOpenHouseSettings == nil)

                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Mais opções")
                .accessibilityIdentifier("houseOptionsMenu")
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
        .sheet(
            isPresented: $isPresentingReorderSheet
        ) {
            ReordenarComodosView(
                rooms: reorderRoomItems,
                onSave: { newOrder in
                    orderedRoomIDs = newOrder.map(\.id)
                }
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

            ForEach(orderedRooms(rooms)) { room in

                Button {
                    onSelectRoom(room.id)
                } label: {

                    HStack(
                        spacing: DesignSystem.contentSpacing
                    ) {

                        RoomIconView(
                            icon: room.icon,
                            color: room.color,
                            size: 40
                        )

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

    // MARK: - Reordenação

    private var reorderRoomItems: [RoomItem] {

        guard case let .content(rooms) = viewModel.state else {
            return []
        }

        return orderedRooms(rooms).map { room in
            RoomItem(
                id: room.id,
                name: room.name,
                symbol: room.icon,
                color: color(for: room.color),
                isPrivate: room.visibility == .privateRoom
            )
        }
    }

    private func orderedRooms(
        _ rooms: [Room]
    ) -> [Room] {

        guard !orderedRoomIDs.isEmpty else {
            return rooms
        }

        let roomsByID = Dictionary(
            uniqueKeysWithValues: rooms.map {
                ($0.id, $0)
            }
        )

        var ordered = orderedRoomIDs.compactMap {
            roomsByID[$0]
        }

        let alreadyOrdered = Set(
            ordered.map(\.id)
        )

        ordered.append(
            contentsOf: rooms.filter {
                !alreadyOrdered.contains($0.id)
            }
        )

        return ordered
    }

    private func color(
        for roomColor: RoomColor
    ) -> Color {

        switch roomColor {

        case .red:
            return .red

        case .orange:
            return .orange

        case .yellow:
            return .yellow

        case .green:
            return .green

        case .blue:
            return .blue

        case .purple:
            return .purple

        case .brown:
            return .brown

        case .gray:
            return .gray

        case .pink:
            return .pink

        }
    }

    private var existingRoomNames: [String] {

        switch viewModel.state {

        case let .content(rooms):
            return rooms.map(\.name)

        case .idle,
             .loading,
             .empty,
             .failure:
            return []
        }
    }
}
