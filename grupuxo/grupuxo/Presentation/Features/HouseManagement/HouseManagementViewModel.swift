import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class HouseManagementViewModel: ObservableObject {

    @Published private(set) var state: HouseManagementState = .idle

    /// Falha de uma ação (pedir ou cancelar entrada); a tela mostra um alerta e mantém o conteúdo.
    @Published var actionError: String?

    let houseName: String

    private let getHouseOverview: GetHouseOverviewUseCase
    private let requestRoomAccess: RequestRoomAccessUseCase
    private let cancelRoomAccessRequest: CancelRoomAccessRequestUseCase

    private let houseID: House.ID
    private let userID: User.ID

    private let now: () -> Date
    private let text: HouseOverviewText

    init(
        getHouseOverview: GetHouseOverviewUseCase,
        requestRoomAccess: RequestRoomAccessUseCase,
        cancelRoomAccessRequest: CancelRoomAccessRequestUseCase,
        houseName: String,
        houseID: House.ID,
        userID: User.ID,
        now: @escaping () -> Date = { .now },
        calendar: Calendar = .current,
        locale: Locale = HouseOverviewText.appLocale
    ) {
        self.getHouseOverview = getHouseOverview
        self.requestRoomAccess = requestRoomAccess
        self.cancelRoomAccessRequest = cancelRoomAccessRequest
        self.houseName = houseName
        self.houseID = houseID
        self.userID = userID
        self.now = now
        self.text = HouseOverviewText(calendar: calendar, locale: locale)
    }

    func load() async {

        // Recarregar não esvazia a tela: o conteúdo atual fica até o novo chegar.
        if case .content = state {} else {
            state = .loading
        }

        do {

            let date = now()

            let overview = try await getHouseOverview(
                houseID: houseID,
                userID: userID,
                at: date
            )

            state = overview.rooms.isEmpty
                ? .empty
                : .content(content(from: overview, at: date))

        } catch {

            state = .failure(
                error.localizedDescription
            )
        }
    }

    func requestAccess(to roomID: Room.ID) async {

        await perform {
            try await requestRoomAccess(
                roomID: roomID,
                userID: userID,
                at: now()
            )
        }
    }

    func cancelAccessRequest(for roomID: Room.ID) async {

        await perform {
            try await cancelRoomAccessRequest(
                roomID: roomID,
                userID: userID
            )
        }
    }

    private func perform(
        _ action: () async throws -> Void
    ) async {

        do {
            try await action()
        } catch {
            actionError = error.localizedDescription
        }

        await load()
    }

    var roomNames: [String] {

        guard case let .content(content) = state else { return [] }

        return content.rooms.map(\.name)
    }

    // MARK: - Apresentação

    private func content(
        from overview: HouseOverview,
        at date: Date
    ) -> HouseManagementContent {

        HouseManagementContent(
            sporadic: sporadicSummary(from: overview),
            rooms: overview.rooms.map { roomRow(from: $0, at: date) }
        )
    }

    private func roomRow(
        from overview: RoomOverview,
        at date: Date
    ) -> RoomRow {

        let room = overview.room

        let access: RoomRow.Access

        if overview.isMember {

            access = .member(
                RoomRow.Member(
                    isPrivate: room.visibility == .privateRoom,
                    responsibles: text.responsibles(
                        names: overview.cycleResponsibleNames,
                        userIDs: overview.cycleResponsibleUserIDs,
                        currentUserID: userID
                    ),
                    deadline: text.deadline(
                        cycleEnd: overview.periodEnd,
                        now: date
                    ),
                    progress: overview.cycleProgress
                        ?? CycleProgress(completed: 0, total: 0)
                )
            )

        } else {

            access = .restricted(
                requestPending: overview.accessRequestPending
            )
        }

        return RoomRow(
            id: room.id,
            name: room.name,
            icon: room.icon,
            color: room.color,
            access: access
        )
    }

    private func sporadicSummary(
        from overview: HouseOverview
    ) -> SporadicSummary {

        let appearanceByRoom = Dictionary(
            overview.rooms.map { ($0.room.id, $0.room) },
            uniquingKeysWith: { first, _ in first }
        )

        func appearance(
            of item: TaskItem
        ) -> (icon: String, color: RoomColor) {

            let room = appearanceByRoom[item.definition.roomID]

            return (
                room?.icon ?? "square.dashed",
                room?.color ?? .gray
            )
        }

        let tasks = overview.sporadicTasks
        let maxRows = SporadicSummary.maxVisibleRows

        let shown = tasks.count > maxRows
            ? tasks.prefix(maxRows - 1)
            : tasks.prefix(maxRows)

        var rows: [SporadicSummary.Row] = shown.map { item in

            let look = appearance(of: item)

            return .task(
                id: item.id,
                name: item.definition.name,
                icon: look.icon,
                color: look.color
            )
        }

        if tasks.count > maxRows {

            rows.append(
                .overflow(count: tasks.count - (maxRows - 1))
            )
        }

        return SporadicSummary(
            rows: rows,
            totalCount: tasks.count
        )
    }
}
