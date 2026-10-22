import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

struct HouseOverviewTests {

    @MainActor
    private func makeContainer(
        state: MockStore.State = MockSeed.make()
    ) -> AppContainer {
        AppContainer(store: MockStore(state: state))
    }

    @MainActor
    private func makeModel(
        user: User = MockSeed.currentUser,
        container: AppContainer? = nil
    ) -> HouseManagementViewModel {

        let container = container ?? makeContainer()
        let session = AppSession(currentUser: user, currentHouse: MockSeed.house)

        return container.makeHouseManagementViewModel(session: session)
    }

    @MainActor
    private func loadedContent(
        _ model: HouseManagementViewModel
    ) async throws -> HouseManagementContent {

        await model.load()

        guard case let .content(content) = model.state else {
            Issue.record("Expected content, got \(model.state)")
            throw CancellationError()
        }

        return content
    }

    @MainActor
    private func overview(
        for user: User,
        container: AppContainer? = nil
    ) async throws -> HouseOverview {

        let container = container ?? makeContainer()

        return try await GetHouseOverviewUseCase(
            roomRepository: container.roomRepository,
            taskRepository: container.taskRepository,
            accessRequestRepository: container.roomAccessRequestRepository
        )(houseID: MockSeed.house.id, userID: user.id, at: .now)
    }

    // MARK: - Caso de uso

    @Test @MainActor func overviewCoversEveryRoomAndHidesWhatTheUserCannotAccess() async throws {

        let overview = try await overview(for: MockSeed.currentUser)

        #expect(overview.rooms.count == MockSeed.rooms.count)

        let privateRoomIDs = Set(MockSeed.privateMembers.map(\.room.id))
        let marinasPrivateRooms: Set<Room.ID> = [MockSeed.privateOffice.id]

        for room in overview.rooms {

            let isMember = !privateRoomIDs.contains(room.id) || marinasPrivateRooms.contains(room.id)

            #expect(room.isMember == isMember)
            #expect(room.cycleResponsibleNames.count == room.cycleResponsibleUserIDs.count)

            if isMember {
                #expect(room.cycleResponsibleNames.count == room.room.responsibleCount)
                #expect(room.cycleProgress != nil)
                #expect(room.periodEnd > .now)
            } else {
                #expect(room.cycleResponsibleNames.isEmpty)
                #expect(room.cycleProgress == nil)
            }
        }
    }

    @Test @MainActor func cycleProgressCountsCompletedTasksOfTheCurrentCycle() async throws {

        let overview = try await overview(for: MockSeed.currentUser)

        func progress(_ room: Room) throws -> CycleProgress? {
            try #require(overview.rooms.first { $0.room.id == room.id }).cycleProgress
        }

        #expect(try progress(MockSeed.bathroom) == CycleProgress(completed: 2, total: 4))
        #expect(try progress(MockSeed.kitchen) == CycleProgress(completed: 2, total: 4))
        #expect(try progress(MockSeed.livingRoom) == CycleProgress(completed: 1, total: 4))
        #expect(try progress(MockSeed.garage) == CycleProgress(completed: 0, total: 3))
    }

    @Test func cycleProgressFractionIsBoundedAndSafeWithoutTasks() {
        #expect(CycleProgress(completed: 4, total: 6).fraction == 4.0 / 6.0)
        #expect(CycleProgress(completed: 0, total: 0).fraction == 0)
    }

    @Test @MainActor func nonMemberOfPrivateRoomGetsNoCycleDetails() async throws {

        let overview = try await overview(for: MockSeed.leo)

        let office = try #require(overview.rooms.first { $0.room.id == MockSeed.privateOffice.id })

        #expect(!office.isMember)
        #expect(office.cycleResponsibleNames.isEmpty)
        #expect(office.cycleProgress == nil)
    }

    @Test @MainActor func garageCycleLastsTwoWeeks() async throws {

        let overview = try await overview(for: MockSeed.currentUser)

        let garage = try #require(overview.rooms.first { $0.room.id == MockSeed.garage.id })
        let kitchen = try #require(overview.rooms.first { $0.room.id == MockSeed.kitchen.id })

        #expect(garage.periodEnd.timeIntervalSince(garage.periodStart) > kitchen.periodEnd.timeIntervalSince(kitchen.periodStart))
    }

    @Test func taskIsLinkedOnlyWhenItFollowsTheRoomSchedule() {

        let room = MockSeed.kitchen

        func task(
            policy: TaskAssignmentPolicy,
            kind: TaskKind = .recurring,
            recurrence: RecurrencePolicy? = nil,
            roomID: Room.ID = MockSeed.kitchen.id
        ) -> TaskDefinition {
            TaskDefinition(
                id: UUID(), roomID: roomID, name: "Tarefa", details: "",
                effort: TaskEffort(points: 1), kind: kind,
                recurrence: recurrence ?? .weekly(room.periodicity),
                assignmentPolicy: policy
            )
        }

        #expect(task(policy: .balancedAutomatically).isLinked(to: room))
        #expect(task(policy: .calendarRotation).isLinked(to: room))
        #expect(!task(policy: .afterCompletion).isLinked(to: room))
        #expect(!task(policy: .selfAssigned).isLinked(to: room))
        #expect(!task(policy: .balancedAutomatically, kind: .sporadic).isLinked(to: room))
        #expect(!task(policy: .balancedAutomatically, roomID: MockSeed.bathroom.id).isLinked(to: room))
        #expect(!task(
            policy: .balancedAutomatically,
            recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 1, intervalWeeks: 2))
        ).isLinked(to: room))
    }

    // MARK: - ViewModel

    @Test @MainActor func memberRoomsShowDetailsAndOnlyPrivateOnesShowTheOpenLock() async throws {

        let content = try await loadedContent(makeModel())

        #expect(content.rooms.count == MockSeed.rooms.count)

        guard case let .member(office) = try #require(content.rooms.first { $0.id == MockSeed.privateOffice.id }).access else {
            Issue.record("Expected the office to be a member row")
            return
        }

        #expect(office.isPrivate)

        guard case let .member(kitchen) = try #require(content.rooms.first { $0.id == MockSeed.kitchen.id }).access else {
            Issue.record("Expected the kitchen to be a member row")
            return
        }

        #expect(!kitchen.isPrivate)
        #expect(kitchen.responsibles?.isEmpty == false)
        #expect(kitchen.deadline.hasPrefix("Termina"))
        #expect(kitchen.progress == CycleProgress(completed: 2, total: 4))
    }

    @Test @MainActor func privateRoomsWithoutAccessAreRestrictedAndReflectPendingRequests() async throws {

        let content = try await loadedContent(makeModel())

        let bedroom = try #require(content.rooms.first { $0.id == MockSeed.bedroom.id })
        let secondBathroom = try #require(content.rooms.first { $0.id == MockSeed.secondBathroom.id })

        #expect(bedroom.access == .restricted(requestPending: false))
        #expect(secondBathroom.access == .restricted(requestPending: true))
    }

    @Test @MainActor func requestingAndCancelingAccessUpdatesTheRow() async throws {

        let model = makeModel()
        _ = try await loadedContent(model)

        await model.requestAccess(to: MockSeed.bedroom.id)

        guard case let .content(afterRequest) = model.state else {
            Issue.record("Expected content")
            return
        }

        #expect(afterRequest.rooms.first { $0.id == MockSeed.bedroom.id }?.access == .restricted(requestPending: true))

        // Pedir de novo é idempotente.
        await model.requestAccess(to: MockSeed.bedroom.id)
        #expect(model.actionError == nil)

        await model.cancelAccessRequest(for: MockSeed.bedroom.id)

        guard case let .content(afterCancel) = model.state else {
            Issue.record("Expected content")
            return
        }

        #expect(afterCancel.rooms.first { $0.id == MockSeed.bedroom.id }?.access == .restricted(requestPending: false))
    }

    @Test @MainActor func requestingAccessToACommonRoomFailsWithoutLosingContent() async throws {

        let model = makeModel()
        let before = try await loadedContent(model)

        await model.requestAccess(to: MockSeed.kitchen.id)

        #expect(model.actionError == DomainError.roomAccessNotRequestable.errorDescription)
        #expect(model.state == .content(before))
    }

    @Test @MainActor func houseNameComesFromTheSession() {
        #expect(makeModel().houseName == MockSeed.house.name)
    }

    @Test @MainActor func sporadicSummaryShowsTwoTasksAndTheRestAsOverflow() async throws {

        let content = try await loadedContent(makeModel())

        #expect(content.sporadic.totalCount == 4)
        #expect(content.sporadic.rows.count == SporadicSummary.maxVisibleRows)

        let tasks = content.sporadic.rows.compactMap { row -> (icon: String, color: RoomColor)? in
            if case let .task(_, _, icon, color) = row { (icon, color) } else { nil }
        }

        #expect(tasks.count == SporadicSummary.maxVisibleRows - 1)

        let rooms = Dictionary(uniqueKeysWithValues: MockSeed.rooms.map { ($0.icon, $0.color) })
        #expect(tasks.allSatisfy { rooms[$0.icon] == $0.color })

        guard case let .overflow(count) = try #require(content.sporadic.rows.last) else {
            Issue.record("Expected an overflow row")
            return
        }

        #expect(count == 4 - (SporadicSummary.maxVisibleRows - 1))
    }

    @Test @MainActor func sporadicSummaryWithFewTasksHasNoOverflow() async throws {

        var seed = MockSeed.make()
        let keep = seed.definitions.filter { $0.kind == .sporadic }.prefix(2).map(\.id)

        let removed = Set(seed.definitions.filter { $0.kind == .sporadic && !keep.contains($0.id) }.map(\.id))
        seed.definitions.removeAll { removed.contains($0.id) }
        seed.occurrences.removeAll { removed.contains($0.taskDefinitionID) }

        let content = try await loadedContent(makeModel(container: makeContainer(state: seed)))

        #expect(content.sporadic.totalCount == 2)
        #expect(content.sporadic.rows.allSatisfy {
            if case .task = $0 { true } else { false }
        })
    }

    @Test @MainActor func houseWithoutRoomsIsEmpty() async {

        var seed = MockSeed.make()
        seed.rooms = []
        seed.roomMemberships = []
        seed.definitions = []
        seed.occurrences = []
        seed.assignments = []

        let model = makeModel(container: makeContainer(state: seed))
        await model.load()

        #expect(model.state == .empty)
    }

    @Test @MainActor func userOutsideTheHouseFails() async {

        let outsider = User(id: UUID(), name: "Fora", email: nil)
        let model = makeModel(user: outsider)
        await model.load()

        guard case .failure = model.state else {
            Issue.record("Expected failure, got \(model.state)")
            return
        }
    }

    @Test @MainActor func reloadKeepsContentInsteadOfFlashingTheSpinner() async throws {

        let model = makeModel()
        let first = try await loadedContent(model)

        await model.load()

        #expect(model.state == .content(first))
    }

    // MARK: - Formatadores

    private var text: HouseOverviewText {

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!

        return HouseOverviewText(calendar: calendar, locale: Locale(identifier: "pt_BR"))
    }

    private func date(_ day: Int, hour: Int = 0) -> Date {

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!

        return calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour))!
    }

    @Test func shortNameKeepsGivenNameAndFamilyInitial() {
        #expect(ResidentNameFormatting.shortName("Julia Carvalho") == "Julia C.")
        #expect(ResidentNameFormatting.shortName("  Marina ") == "Marina")
    }

    @Test func deadlineDescribesTheLastDayOfTheCycle() {

        // 14/10/2026 é quarta-feira; o fim do ciclo é exclusivo, então o último dia é o anterior.
        let now = date(14, hour: 12)

        #expect(text.deadline(cycleEnd: date(15), now: now) == "Termina hoje")
        #expect(text.deadline(cycleEnd: date(16), now: now) == "Termina amanhã")
        #expect(text.deadline(cycleEnd: date(19), now: now) == "Termina domingo")
        #expect(text.deadline(cycleEnd: date(28), now: now) == "Termina em 13 dias")
        #expect(text.deadline(cycleEnd: date(10), now: now) == "Termina hoje")
    }

    @Test func responsiblesPutTheCurrentUserFirstAsYou() {

        let me = UUID()
        let anna = UUID()
        let gabriel = UUID()

        #expect(
            text.responsibles(
                names: ["Gabriel Moreira", "Marina"],
                userIDs: [gabriel, me],
                currentUserID: me
            ) == "Você e Gabriel M."
        )

        #expect(
            text.responsibles(
                names: ["Anna Martins"],
                userIDs: [anna],
                currentUserID: me
            ) == "Anna M."
        )

        #expect(text.responsibles(names: [], userIDs: [], currentUserID: me) == nil)
    }

    @Test func progressTextAgreesWithTheTaskCount() {
        #expect(HouseOverviewText.progress(CycleProgress(completed: 4, total: 6)) == "4 de 6 tarefas feitas")
        #expect(HouseOverviewText.progress(CycleProgress(completed: 1, total: 1)) == "1 de 1 tarefa feita")
        #expect(HouseOverviewText.progress(CycleProgress(completed: 0, total: 0)) == "Nenhuma tarefa neste ciclo")
    }
}
