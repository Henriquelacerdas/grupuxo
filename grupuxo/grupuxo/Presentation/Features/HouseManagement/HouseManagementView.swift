import SwiftUI
import GrupuxoDomain

struct HouseManagementView: View {

    @StateObject private var viewModel: HouseManagementViewModel

    @State private var isPresentingTaskCreationSheet = false
    @State private var isPresentingRoomCreationSheet = false
    @State private var isPresentingReorderSheet = false
    @State private var orderedRoomIDs: [Room.ID] = []

    /// Nome da casa, mostrado como subtítulo do título "Casa".
    let houseName: String

    let makeTaskEditorViewModel: () -> TaskEditorViewModel
    let makeRoomEditorViewModel: () -> RoomEditorViewModel

    let onSelectRoom: (Room.ID) -> Void
    let onSelectSporadicTasks: () -> Void
    private let reloadTrigger: AnyHashable

    /// Abre os ajustes da casa (nome, código, moradores); sem ele, a opção do menu fica desabilitada.
    let onOpenHouseSettings: (() -> Void)?

    /// Texto do convite (nome da casa e código) para o compartilhar do sistema; sem ele, a opção some.
    let inviteMessage: String?

    init(
        viewModel: HouseManagementViewModel,
        houseName: String,
        makeTaskEditorViewModel: @escaping () -> TaskEditorViewModel,
        makeRoomEditorViewModel: @escaping () -> RoomEditorViewModel,
        onSelectRoom: @escaping (Room.ID) -> Void,
        onSelectSporadicTasks: @escaping () -> Void,
        onOpenHouseSettings: (() -> Void)? = nil,
        inviteMessage: String? = nil,
        reloadTrigger: AnyHashable = 0
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)

        self.reloadTrigger = reloadTrigger
        self.houseName = houseName
        self.makeTaskEditorViewModel = makeTaskEditorViewModel
        self.makeRoomEditorViewModel = makeRoomEditorViewModel

        self.onSelectRoom = onSelectRoom
        self.onSelectSporadicTasks = onSelectSporadicTasks
        self.onOpenHouseSettings = onOpenHouseSettings
        self.inviteMessage = inviteMessage
    }

    /// Itens do menu "+" (HIG: escolha do que criar a partir de um botão da barra é um menu, não um diálogo).
    @ViewBuilder
    private var addMenuItems: some View {
        Button("Nova tarefa", systemImage: "checklist") {
            isPresentingTaskCreationSheet = true
        }
        .accessibilityIdentifier("createTask")

        Button("Novo cômodo", systemImage: "square.split.bottomrightquarter") {
            isPresentingRoomCreationSheet = true
        }
        .accessibilityIdentifier("createRoom")
    }

    /// Ação principal da barra: círculo azul de 44 pt, do mesmo tamanho do "⋯" ao lado.
    @ToolbarContentBuilder
    private var addToolbarItem: some ToolbarContent {
        if #available(iOS 26, *) {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    addMenuItems
                } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(
                            width: DesignSystem.minimumTouchTarget,
                            height: DesignSystem.minimumTouchTarget
                        )
                        .glassEffect(.regular.tint(.accentColor).interactive(), in: .circle)
                }
                .accessibilityLabel("Adicionar")
                .accessibilityIdentifier("addMenu")
            }
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    addMenuItems
                } label: {
                    Label("Adicionar", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("addMenu")
            }
        }
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

                ForEach(orderedRoomRows(content.rooms)) { row in
                    roomRow(row)
                }

            case .empty:
                statusRow {
                    EmptyStateView(
                        title: "Nenhum cômodo ainda",
                        systemImage: "house",
                        description: "Crie o primeiro cômodo para começar o rodízio da casa."
                    )
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
        .houseSubtitle(houseName)
        .toolbar {
            addToolbarItem

            if #available(iOS 26, *) {
                ToolbarSpacer(
                    .fixed,
                    placement: .topBarTrailing
                )
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(
                        "Reordenar cômodos",
                        systemImage: "line.3.horizontal"
                    ) {
                        isPresentingReorderSheet = true
                    }

                    if let inviteMessage {
                        ShareLink(item: inviteMessage) {
                            Label("Convidar pessoas", systemImage: "person.badge.plus")
                        }
                    }

                    Button(
                        "Ajustes da casa",
                        systemImage: "gearshape"
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
        .alert(
            "Não foi possível concluir",
            isPresented: actionErrorBinding,
            presenting: viewModel.actionError
        ) { _ in
            Button(
                "OK",
                role: .cancel
            ) {}
        } message: { message in
            Text(message)
        }
        .task(id: reloadTrigger) {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load(forceRefresh: true)
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
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )
            .padding(
                .top,
                DesignSystem.Spacing.small
            )
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
                RoomCard(
                    row: row,
                    member: member
                )
            }
            .buttonStyle(.plain)
            .plainCardRow()

        case let .restricted(requestPending):
            RestrictedRoomCard(
                row: row,
                requestPending: requestPending,
                onRequest: {
                    Task {
                        await viewModel.requestAccess(
                            to: row.id
                        )
                    }
                },
                onCancel: {
                    Task {
                        await viewModel.cancelAccessRequest(
                            for: row.id
                        )
                    }
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

    // MARK: - Reordenação

    private var reorderRoomItems: [RoomItem] {
        guard case let .content(content) = viewModel.state else {
            return []
        }

        return orderedRoomRows(content.rooms)
            .compactMap { row in
                guard case let .member(member) = row.access else {
                    return nil
                }

                return RoomItem(
                    id: row.id,
                    name: row.name,
                    symbol: row.icon,
                    color: color(for: row.color),
                    isPrivate: member.isPrivate
                )
            }
    }

    private func orderedRoomRows(
        _ rows: [RoomRow]
    ) -> [RoomRow] {
        guard !orderedRoomIDs.isEmpty else {
            return rows
        }

        let memberRows = rows.filter { row in
            if case .member = row.access {
                return true
            }

            return false
        }

        let memberByID = Dictionary(
            uniqueKeysWithValues: memberRows.map {
                ($0.id, $0)
            }
        )

        var orderedMembers = orderedRoomIDs.compactMap {
            memberByID[$0]
        }

        let alreadyOrdered = Set(
            orderedMembers.map(\.id)
        )

        orderedMembers.append(
            contentsOf: memberRows.filter {
                !alreadyOrdered.contains($0.id)
            }
        )

        var iterator = orderedMembers.makeIterator()

        return rows.map { row in
            if case .member = row.access {
                return iterator.next() ?? row
            }

            return row
        }
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

        case .teal:
            return .teal

        case .indigo:
            return .indigo

        case .cyan:
            return .cyan
        }
    }

    private var existingRoomNames: [String] {
        viewModel.roomNames
    }

    private var actionErrorBinding: Binding<Bool> {
        Binding(
            get: {
                viewModel.actionError != nil
            },
            set: {
                if !$0 {
                    viewModel.actionError = nil
                }
            }
        )
    }
}

private extension View {

    /// Subtítulo do título grande (iOS 26); antes disso a tela fica só com o título.
    @ViewBuilder
    func houseSubtitle(_ name: String) -> some View {
        if #available(iOS 26, *) {
            navigationSubtitle(name)
        } else {
            self
        }
    }
}
