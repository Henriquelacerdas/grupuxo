import Foundation
import os
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

struct MyTasksOverviewTests {

    @MainActor
    private func makeContainer() -> AppContainer {
        AppContainer(store: MockStore(state: MockSeed.make()))
    }

    @MainActor
    private func overview(
        container: AppContainer,
        user: User = MockSeed.currentUser
    ) async throws -> MyTasksOverview {

        try await GetMyTasksOverviewUseCase(
            roomRepository: container.roomRepository,
            taskRepository: container.taskRepository
        )(
            houseID: MockSeed.house.id,
            userID: user.id,
            at: .now,
            calendar: Calendar(identifier: .gregorian)
        )
    }

    // MARK: - Caso de uso

    @Test @MainActor func cycleGroupsHoldOnlyMyTasksThatFollowTheRoomSchedule() async throws {

        let overview = try await overview(container: makeContainer())

        #expect(!overview.cycleGroups.isEmpty)

        for group in overview.cycleGroups {

            #expect(!group.tasks.isEmpty)
            #expect(group.periodEnd > .now)

            for item in group.tasks {
                #expect(item.definition.roomID == group.room.id)
                #expect(item.definition.isLinked(to: group.room))
                #expect(item.assignment?.userID == MockSeed.currentUser.id)
            }
        }

        let roomIDs = overview.cycleGroups.map(\.room.id)
        #expect(Set(roomIDs).count == roomIDs.count)
    }

    @Test @MainActor func extraTasksAreRecurringTasksOutsideTheRoomSchedule() async throws {

        let overview = try await overview(container: makeContainer())

        for task in overview.extraTasks {
            #expect(task.item.definition.kind == .recurring)
            #expect(!task.item.definition.isLinked(to: task.room))
            #expect(task.item.definition.roomID == task.room.id)
        }

        let cycleIDs = Set(overview.cycleGroups.flatMap(\.tasks).map(\.id))
        #expect(overview.extraTasks.allSatisfy { !cycleIDs.contains($0.id) })
    }

    @Test @MainActor func sporadicTasksAppearOnlyAfterTheResidentClaimsThem() async throws {

        let container = makeContainer()

        #expect(try await overview(container: container).sporadicTasks.isEmpty)

        let open = try await container.taskRepository.sporadicTasks(
            in: MockSeed.house.id,
            requesting: MockSeed.currentUser.id
        )
        let target = try #require(open.first { $0.assignment == nil })

        try await container.taskRepository.claim(
            occurrenceID: target.id,
            by: MockSeed.currentUser.id,
            at: .now
        )

        let claimed = try await overview(container: container).sporadicTasks

        #expect(claimed.map(\.id) == [target.id])
        #expect(claimed.first?.room.id == target.definition.roomID)
        #expect(claimed.allSatisfy { $0.item.definition.kind == .sporadic })
    }

    @Test @MainActor func overviewIsStableAcrossLoads() async throws {

        let container = makeContainer()

        let first = try await overview(container: container)
        let second = try await overview(container: container)

        #expect(first == second)
    }

    // MARK: - ViewModel

    @Test @MainActor func viewModelPresentsTheThreeSectionsWithTheirTexts() async throws {

        let container = makeContainer()
        let session = AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house)
        let model = container.makeMyTasksViewModel(session: session)

        await model.load()

        guard case let .content(content) = model.state else {
            Issue.record("Expected content, got \(model.state)")
            return
        }

        for cycle in content.cycles {
            #expect(cycle.status.hasPrefix("Termina"))
            #expect(cycle.rows.allSatisfy { $0.roomName == nil && $0.dueDay == nil })
        }

        #expect(content.extras.allSatisfy { $0.roomName != nil })
    }

    // MARK: - Textos

    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 2
        return calendar
    }

    private func date(_ day: Int) -> Date {
        utcCalendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: 12))!
    }

    @Test @MainActor func backgroundReloadFailureKeepsTheListOnScreen() async throws {

        let container = makeContainer()
        let rooms = FailingRoomRepository(base: container.roomRepository)
        let model = MyTasksViewModel(
            getMyTasksOverview: GetMyTasksOverviewUseCase(roomRepository: rooms, taskRepository: container.taskRepository),
            completeTask: CompleteTaskUseCase(repository: container.taskRepository),
            endTask: EndTaskUseCase(repository: container.taskRepository),
            user: MockSeed.currentUser,
            houseName: MockSeed.house.name,
            houseID: MockSeed.house.id
        )

        await model.load()
        #expect(model.state.hasLoaded)
        let loaded = model.state

        // Trocar de tela cancela a carga: a lista fica.
        rooms.failure.withLock { $0 = CancellationError() }
        await model.load(showLoading: false)
        #expect(model.state == loaded)

        // Recarga em segundo plano sem rede: a lista fica.
        rooms.failure.withLock { $0 = APIError.network }
        await model.load(showLoading: false)
        #expect(model.state == loaded)

        // Recarga pedida pelo morador mostra a falha.
        await model.load()
        #expect(model.state == .failure(APIError.network.localizedDescription))
    }

    @Test func dueDayReadsAsTodayTomorrowWeekdayOrDate() {

        let text = MyTasksText(calendar: utcCalendar, locale: Locale(identifier: "pt_BR"))
        let now = date(14) // quarta-feira

        #expect(text.dueDay(date(14), now: now) == "Hoje")
        #expect(text.dueDay(date(15), now: now) == "Amanhã")
        #expect(text.dueDay(date(16), now: now) == "Sexta-Feira")
        #expect(text.dueDay(date(13), now: now) == "Atrasada")
        #expect(text.dueDay(date(28), now: now).contains("28"))
    }

    @Test func cycleStatusJoinsDeadlineAndProgress() {

        let text = MyTasksText(calendar: utcCalendar, locale: Locale(identifier: "pt_BR"))
        let now = date(14)

        #expect(
            text.cycleStatus(
                periodEnd: date(19),
                progress: CycleProgress(completed: 2, total: 5),
                now: now
            ) == "Termina domingo · 2 de 5"
        )

        #expect(
            text.cycleStatus(
                periodEnd: date(19),
                progress: CycleProgress(completed: 0, total: 0),
                now: now
            ) == "Termina domingo"
        )
    }
}

/// Repassa ao repositório de verdade até o teste pedir uma falha.
private final class FailingRoomRepository: RoomRepository {
    let base: any RoomRepository
    let failure = OSAllocatedUnfairLock<(any Error)?>(initialState: nil)

    init(base: any RoomRepository) {
        self.base = base
    }

    private func check() throws {
        if let error = failure.withLock({ $0 }) { throw error }
    }

    func participation(in roomID: Room.ID, requesting userID: User.ID, at date: Date) async throws -> RoomParticipation {
        try check()
        return try await base.participation(in: roomID, requesting: userID, at: date)
    }

    func room(id: Room.ID, requesting userID: User.ID) async throws -> Room {
        try check()
        return try await base.room(id: id, requesting: userID)
    }

    func rooms(in houseID: House.ID, requesting userID: User.ID) async throws -> [Room] {
        try check()
        return try await base.rooms(in: houseID, requesting: userID)
    }

    func create(_ room: Room, memberships: [RoomMembership]) async throws -> Room {
        try await base.create(room, memberships: memberships)
    }
}
