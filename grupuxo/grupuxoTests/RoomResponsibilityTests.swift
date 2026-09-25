import Foundation
import Testing
@testable import grupuxo

struct RoomResponsibilityTests {
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Sao_Paulo")!
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        return c
    }
    var service: TaskSchedulingService { TaskSchedulingService(calendar: calendar) }
    var monday: Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: 14))! }
    func state(count: Int = 1, n: Int = 2, weeks: Int = 2) -> TaskSchedulingState {
        var s = MockSeed.make().schedule
        s.definitions = []; s.occurrences = []; s.assignments = []
        for i in s.rooms.indices {
            s.rooms[i].scheduleVersions = []
            s.rooms[i].calendarAnchor = monday
            s.rooms[i].periodicity = WeeklyPeriodicity(executionsPerPeriod: n, intervalWeeks: weeks)
            s.rooms[i].responsibleCount = count
        }
        return s
    }
    func task(effort: Int = 2, n: Int = 2, weeks: Int = 2, room: UUID = MockSeed.kitchen.id) -> TaskDefinition {
        TaskDefinition(id: UUID(), roomID: room, name: "Limpar", details: "", effort: TaskEffort(points: effort),
            kind: .recurring, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: n, intervalWeeks: weeks)), assignmentPolicy: .calendarRotation)
    }
    func owner(_ occurrence: TaskOccurrence, in s: TaskSchedulingState) -> UUID? {
        s.assignments.first { $0.occurrenceID == occurrence.id && $0.isActive }?.userID
    }

    @Test func linkedTasksShareOwnersAndRotateOnlyAfterPeriod() throws {
        var s = state()
        let a = try service.create(task(), at: monday, state: &s)
        let b = try service.create(task(effort: 3), at: monday, state: &s)
        #expect(a.rotationQueue.isEmpty && b.rotationQueue.isEmpty)
        let dates = Set(s.occurrences.map(\.availableAt)).sorted()
        let owners = dates.map { date in
            Set(s.occurrences.filter { $0.availableAt == date }.compactMap { owner($0, in: s) })
        }
        #expect(owners.allSatisfy { $0.count == 1 })
        #expect(owners[0] == owners[1])
        #expect(owners[1] != owners[2])
        #expect(Set(owners.prefix(8).flatMap { $0 }).count == 4)
        let before = s.occurrences
        try service.refresh(houseID: MockSeed.house.id, at: monday, state: &s)
        #expect(s.occurrences == before)
    }

    @Test func greedyBlocksAreBalancedAndAlwaysInsideResponsibleGroup() throws {
        var s = state(count: 2)
        for effort in [3, 3, 2, 2, 1] { _ = try service.create(task(effort: effort), at: monday, state: &s) }
        let room = try #require(s.rooms.first { $0.id == MockSeed.kitchen.id })
        let v = try #require(room.scheduleVersions.last)
        var load = [0, 0]
        for d in s.definitions { load[v.taskRoles[d.id]!] += d.effort.points }
        #expect(load.sorted() == [5, 6])
        for o in s.occurrences {
            let d = s.definitions.first { $0.id == o.taskDefinitionID }!
            #expect(owner(o, in: s) == (try service.roomOwner(definition: d, date: o.availableAt, state: s)))
        }
        let owners = Set(s.occurrences.filter { $0.availableAt == monday }.compactMap { owner($0, in: s) })
        #expect(owners.count == 2)
    }

    @Test func midPeriodCreationDoesNotPublishPastDatesAndUsesExactCounts() throws {
        var s = state(n: 3, weeks: 2)
        let start = calendar.date(byAdding: .day, value: 3, to: monday)!
        let d = try service.create(task(n: 3, weeks: 2), at: start, state: &s)
        let dates = s.occurrences.map(\.availableAt).sorted()
        #expect(dates.prefix(3).map { calendar.dateComponents([.day], from: monday, to: $0).day! } == [4, 9, 14])
        #expect(dates.allSatisfy { $0 >= start })
        #expect(d.rotationQueue.isEmpty)
        let other = try service.create(task(n: 6, weeks: 4), at: start, state: &s)
        #expect(!other.rotationQueue.isEmpty) // Same ratio is not the same period.
    }

    @Test func departuresPreservePastAndReplanRoomAsOneUnit() throws {
        var s = state(count: 2)
        for effort in [3, 2, 1] { _ = try service.create(task(effort: effort), at: monday, state: &s) }
        let before = s
        let user = try #require(owner(s.occurrences[0], in: s))
        let wednesday = calendar.date(byAdding: .day, value: 2, to: monday)!
        let boundary = calendar.date(byAdding: .day, value: 7, to: monday)!
        try service.removeMember(userID: user, roomID: MockSeed.kitchen.id, at: wednesday, state: &s)
        #expect(s.rooms.first { $0.id == MockSeed.kitchen.id }?.visibility == .privateRoom)
        for o in s.occurrences {
            if o.availableAt < boundary { #expect(owner(o, in: s) == owner(o, in: before)) }
            else {
                #expect(owner(o, in: s) != user)
                let d = s.definitions.first { $0.id == o.taskDefinitionID }!
                #expect(owner(o, in: s) == (try service.roomOwner(definition: d, date: o.availableAt, state: s)))
            }
        }
        try service.addMember(userID: user, roomID: MockSeed.kitchen.id, at: wednesday, state: &s)
        #expect(s.rooms.first { $0.id == MockSeed.kitchen.id }?.visibility == .privateRoom)
    }

    @Test func privateRoomIsDiscoverableButCannotLeakOrAcceptTasks() async throws {
        var seed = MockSeed.make()
        seed.schedule = state()
        let store = MockStore(state: seed)
        let rooms = MockRoomRepository(store: store, scheduling: service)
        let tasks = MockTaskRepository(store: store, scheduling: service)
        let d = task(room: MockSeed.privateOffice.id)
        _ = try await tasks.create(d, requestedBy: MockSeed.currentUser.id, at: monday)
        #expect(try await rooms.rooms(in: MockSeed.house.id, requesting: MockSeed.rafa.id).contains { $0.id == d.roomID })
        #expect(try await rooms.room(id: d.roomID, requesting: MockSeed.rafa.id).scheduleVersions.isEmpty)
        #expect(try await tasks.tasks(in: d.roomID, requesting: MockSeed.rafa.id).isEmpty)
        await #expect(throws: DomainError.taskUnavailable) {
            try await tasks.create(d, requestedBy: MockSeed.rafa.id, at: monday)
        }
        try await tasks.addMember(userID: MockSeed.rafa.id, to: d.roomID, at: monday)
        #expect(try await !tasks.tasks(in: d.roomID, requesting: MockSeed.rafa.id).isEmpty)
        _ = try await tasks.create(task(room: d.roomID), requestedBy: MockSeed.rafa.id, at: monday)
        await #expect(throws: DomainError.entityNotFound) {
            try await rooms.room(id: d.roomID, requesting: UUID())
        }
    }

    @Test func commonCreationRejectsIncompleteMembershipAndWholeHouseCannotBeLeft() async throws {
        let store = MockStore()
        let repo = MockRoomRepository(store: store)
        let room = Room(id: UUID(), houseID: MockSeed.house.id, name: "Novo", kind: .standard, visibility: .common)
        await #expect(throws: DomainError.invalidRoomParticipants) {
            try await repo.create(room, memberships: [RoomMembership(id: UUID(), roomID: room.id, userID: MockSeed.currentUser.id)])
        }
        let tasks = MockTaskRepository(store: store, scheduling: service)
        await #expect(throws: DomainError.wholeHouseProtected) {
            try await tasks.removeMember(userID: MockSeed.currentUser.id, from: MockSeed.wholeHouseRoom.id, at: monday, confirmDeletion: true)
        }
    }

    @Test func deletionIsAtomicAndUnconfirmedAttemptPreservesEverything() async throws {
        var seed = MockSeed.make()
        seed.schedule = state()
        seed.roomMemberships.removeAll { $0.roomID == MockSeed.privateOffice.id && $0.userID != MockSeed.currentUser.id }
        let store = MockStore(state: seed)
        let repo = MockTaskRepository(store: store, scheduling: service)
        _ = try await repo.create(task(room: MockSeed.privateOffice.id), requestedBy: MockSeed.currentUser.id, at: monday)
        let before = await store.read { $0.schedule }
        await #expect(throws: DomainError.deletionConfirmationRequired) {
            try await repo.removeMember(userID: MockSeed.currentUser.id, from: MockSeed.privateOffice.id, at: monday)
        }
        #expect(await store.read { $0.occurrences } == before.occurrences)
        #expect(await store.read { $0.rooms } == before.rooms)
        try await repo.removeMember(userID: MockSeed.currentUser.id, from: MockSeed.privateOffice.id, at: monday, confirmDeletion: true)
        let after = await store.read { $0.schedule }
        #expect(after.definitions.isEmpty && after.occurrences.isEmpty && after.assignments.isEmpty)
        #expect(!after.roomMemberships.contains { $0.roomID == MockSeed.privateOffice.id })
    }

    @Test func invalidPeriodicityAndMultipleSlotsRespectConstraints() throws {
        #expect(!WeeklyPeriodicity(executionsPerPeriod: 8, intervalWeeks: 1).isValid)
        #expect(!WeeklyPeriodicity(executionsPerPeriod: 0, intervalWeeks: 1).isValid)
        #expect(!WeeklyPeriodicity(executionsPerPeriod: 1, intervalWeeks: 0).isValid)
        var s = state(count: 10)
        _ = try service.create(task(), at: monday, state: &s)
        #expect(s.rooms.first { $0.id == MockSeed.kitchen.id }?.scheduleVersions.last?.responsibleCount == 4)
    }
    @Test func newTaskDuringPeriodKeepsCurrentResponsibleAndPendingDeparture() throws {
        var s = state(n: 2, weeks: 2)
        let original = try service.create(task(), at: monday, state: &s)
        let firstOwner = try #require(owner(s.occurrences[0], in: s))
        let wednesday = calendar.date(byAdding: .day, value: 2, to: monday)!
        let other = MockSeed.users.first { $0.id != firstOwner }!.id
        try service.removeMember(userID: other, roomID: original.roomID, at: wednesday, state: &s)
        let added = try service.create(task(effort: 3), at: wednesday, state: &s)
        let room = s.rooms.first { $0.id == original.roomID }!
        let version = room.scheduleVersions.last { $0.effectiveAt <= wednesday }!
        #expect(version.queue.first == firstOwner)
        let boundary = calendar.date(byAdding: .day, value: 7, to: monday)!
        #expect(s.occurrences.filter { $0.availableAt >= boundary }.allSatisfy { owner($0, in: s) != other })
        #expect(s.occurrences.filter { $0.taskDefinitionID == added.id }.allSatisfy { $0.availableAt >= wednesday })
    }

    @Test func weeklyGroupsCrossDSTWithoutDrift() throws {
        var c = calendar
        c.timeZone = TimeZone(identifier: "America/New_York")!
        let start = c.date(from: DateComponents(year: 2026, month: 10, day: 26))!
        let planner = TaskSchedulingService(calendar: c)
        var s = state(n: 2, weeks: 2)
        for i in s.rooms.indices { s.rooms[i].calendarAnchor = start }
        _ = try planner.create(task(), at: start, state: &s)
        let dates = s.occurrences.map(\.availableAt).sorted()
        #expect(dates[1].timeIntervalSince(dates[0]) == 169 * 3600)
        #expect(dates.allSatisfy { c.component(.hour, from: $0) == 0 })
    }

    @Test func groupedSlotOptimizationMatchesExhaustiveSearch() throws {
        let users = [UUID(), UUID(), UUID()]
        let turns = (0..<12).flatMap { week in
            [1, 3].map { effort in QueueForecast.Turn(week: week, effort: effort, eligible: Set(users), incumbent: nil, slot: week / 2) }
        }
        let forecast = QueueForecast(participants: users, turns: turns, existingQueue: users)
        var fixed: HouseQueueOptimizer.Grid = [:]
        fixed[users[0]] = (0..<12).map { i in var w = ProjectedWeek(); if i % 3 == 0 { w.add(effort: 3) }; return w }
        let optimizer = HouseQueueOptimizer()
        let result = try optimizer.optimize([forecast], fixed: fixed, debts: [:])
        let costs = try HouseOptimizerTests().permutations(Array(users.indices)).map { permutation in
            try optimizer.score([forecast], queues: [permutation.map { users[$0] }], fixed: fixed, debts: [:])
        }
        #expect(try optimizer.score([forecast], queues: result, fixed: fixed, debts: [:]) == costs.min())
    }

    @Test func houseRemovalConfirmsPrivateCascadeAndKeepsCommonRoomsCommon() async throws {
        var seed = MockSeed.make()
        seed.roomMemberships.removeAll { $0.roomID == MockSeed.privateOffice.id }
        seed.roomMemberships.append(RoomMembership(id: UUID(), roomID: MockSeed.privateOffice.id, userID: MockSeed.rafa.id))
        let store = MockStore(state: seed)
        let repo = MockHouseRepository(store: store, scheduling: service)
        let before = await store.read { $0 }
        await #expect(throws: DomainError.deletionConfirmationRequired) {
            try await repo.removeMember(userID: MockSeed.rafa.id, from: MockSeed.house.id, requestedBy: MockSeed.currentUser.id, at: monday)
        }
        #expect(await store.read { $0.houseMemberships } == before.houseMemberships)
        #expect(await store.read { $0.rooms } == before.rooms)
        try await repo.removeMember(userID: MockSeed.rafa.id, from: MockSeed.house.id, requestedBy: MockSeed.currentUser.id, at: monday, confirmRoomDeletion: true)
        let after = await store.read { $0 }
        #expect(!after.rooms.contains { $0.id == MockSeed.privateOffice.id })
        #expect(after.rooms.allSatisfy { $0.visibility == .common })
        for room in after.rooms {
            #expect(Set(after.roomMemberships.filter { $0.roomID == room.id && $0.isCurrent }.map(\.userID)) == Set(after.houseMemberships.map(\.userID)))
        }
    }

    @Test func linkedScheduleExtendsBeyondHorizonWithoutDuplicates() throws {
        var s = state(n: 3, weeks: 2)
        _ = try service.create(task(n: 3, weeks: 2), at: monday, state: &s)
        let original = s.occurrences
        let future = calendar.date(byAdding: .weekOfYear, value: 30, to: monday)!
        try service.refresh(houseID: MockSeed.house.id, at: future, state: &s)
        let extended = s.occurrences
        try service.refresh(houseID: MockSeed.house.id, at: future, state: &s)
        #expect(s.occurrences == extended)
        #expect(Array(extended.prefix(original.count)) == original)
        #expect(Set(extended.map(\.availableAt)).count == extended.count)
        for occurrence in extended {
            #expect(owner(occurrence, in: s) == (try service.roomOwner(definition: s.definitions[0], date: occurrence.availableAt, state: s)))
        }
    }

}
