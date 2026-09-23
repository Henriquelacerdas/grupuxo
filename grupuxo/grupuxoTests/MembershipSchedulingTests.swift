import Foundation
import Testing
@testable import grupuxo

struct MembershipSchedulingTests {
    var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/Sao_Paulo")!
        value.firstWeekday = 2
        value.minimumDaysInFirstWeek = 4
        return value
    }
    var date: Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: 16, hour: 12))! }
    var boundary: Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: 21))! }
    var service: TaskSchedulingService { TaskSchedulingService(calendar: calendar) }
    func state() -> TaskSchedulingState {
        var state = MockSeed.make().schedule
        state.definitions = []; state.occurrences = []; state.assignments = []
        return state
    }
    func definition(roomID: UUID = MockSeed.kitchen.id, policy: TaskAssignmentPolicy = .calendarRotation) -> TaskDefinition {
        TaskDefinition(id: UUID(), roomID: roomID, name: "Limpar", details: "", effort: TaskEffort(points: 3),
            kind: .recurring, visibility: .house, recurrence: .recurring(frequency: .weekly, interval: 1), assignmentPolicy: policy)
    }

    @Test func departureRetainsPendingCompletionAndReentryKeepsDebt() throws {
        var state = state()
        let task = try service.create(definition(), at: date, state: &state)
        let original = state.occurrences[0]
        let owner = state.assignments[0].userID
        try service.removeMember(userID: owner, roomID: task.roomID, at: date, state: &state)
        #expect(!state.definitions[0].rotationQueue.contains(owner))
        let futureIDs = Set(state.occurrences.filter { $0.availableAt >= boundary }.map(\.id))
        #expect(!state.assignments.contains { $0.isActive && $0.userID == owner && futureIDs.contains($0.occurrenceID) })
        try service.complete(occurrenceID: original.id, by: owner, at: boundary, state: &state)
        let member = state.roomMemberships.first { $0.roomID == task.roomID && $0.userID == owner }!
        #expect(member.fairnessDebt == 2.25)
        try service.addMember(userID: owner, roomID: task.roomID, at: boundary, state: &state)
        let rejoined = state.roomMemberships.first { $0.id == member.id }!
        #expect(rejoined.isCurrent)
        #expect(rejoined.fairnessDebt == member.fairnessDebt)
        #expect(!rejoined.participates(at: boundary))
        #expect(rejoined.participates(at: calendar.date(byAdding: .weekOfYear, value: 1, to: boundary)!))
    }

    @Test func emptyRoomSuspendsAndResumesWithoutDuplicateOccurrences() throws {
        var state = state()
        let user = MockSeed.currentUser.id
        state.roomMemberships.removeAll { $0.roomID == MockSeed.kitchen.id && $0.userID != user }
        _ = try service.create(definition(), at: date, state: &state)
        try service.removeMember(userID: user, roomID: MockSeed.kitchen.id, at: date, state: &state)
        #expect(state.definitions[0].rotationQueue.isEmpty)
        #expect(state.occurrences.filter { $0.availableAt >= boundary }.allSatisfy { $0.status == .available })
        let originalIDs = Set(state.occurrences.map(\.id))
        try service.addMember(userID: user, roomID: MockSeed.kitchen.id, at: date, state: &state)
        #expect(Set(state.occurrences.map(\.id)) == originalIDs)
        #expect(state.occurrences.allSatisfy { $0.status == .assigned })
        #expect(state.roomMemberships.filter { $0.roomID == MockSeed.kitchen.id }.count == 1)
        let next = calendar.date(byAdding: .weekOfYear, value: 20, to: boundary)!
        try service.refresh(houseID: MockSeed.house.id, at: next, state: &state)
        let after = state.occurrences
        try service.refresh(houseID: MockSeed.house.id, at: next, state: &state)
        #expect(state.occurrences == after)
        #expect(Set(state.occurrences.map(\.availableAt)).count == state.occurrences.count)
    }

    @Test func completionQueueActivatesOnlyAtBoundaryAndEmptyQueueResumes() throws {
        var state = state()
        let user = MockSeed.currentUser.id
        state.roomMemberships.removeAll { $0.roomID == MockSeed.kitchen.id && $0.userID != user }
        _ = try service.create(definition(policy: .afterCompletion), at: date, state: &state)
        try service.removeMember(userID: user, roomID: MockSeed.kitchen.id, at: date, state: &state)
        #expect(state.definitions[0].rotationQueue == [user])
        #expect(state.definitions[0].pendingRotation?.queue == [])
        try service.complete(occurrenceID: state.occurrences[0].id, by: user, at: date, state: &state)
        #expect(state.assignments.last?.userID == user)
        try service.complete(occurrenceID: state.occurrences[1].id, by: user, at: boundary, state: &state)
        #expect(state.occurrences.count == 3)
        #expect(state.occurrences.last?.status == .available)
        try service.addMember(userID: user, roomID: MockSeed.kitchen.id, at: boundary, state: &state)
        #expect(state.occurrences.last?.status == .available)
        let next = calendar.date(byAdding: .weekOfYear, value: 1, to: boundary)!
        try service.refresh(houseID: MockSeed.house.id, at: next, state: &state)
        #expect(state.occurrences.count == 3)
        #expect(state.occurrences.last?.status == .assigned)
        #expect(state.assignments.last?.assignedAt == next)
    }

    @Test @MainActor func privateRoomDepartureExposesOnlyRetainedTasks() async throws {
        var seed = MockSeed.make()
        seed.schedule = state()
        let store = MockStore(state: seed)
        let repository = MockTaskRepository(store: store, scheduling: service)
        let task = try await repository.create(definition(roomID: MockSeed.privateOffice.id), at: date)
        let owner = await store.read { $0.assignments[0].userID }
        let remove = AppContainer(store: store, calendar: calendar).makeRemoveRoomMemberUseCase()
        try await remove(userID: owner, roomID: task.roomID, date: date)
        let visible = try await repository.tasks(in: task.roomID, requesting: owner)
        #expect(visible.count == 1)
        #expect(visible[0].assignment?.userID == owner)
        let rooms = try await MockRoomRepository(store: store).rooms(in: MockSeed.house.id, requesting: owner)
        #expect(!rooms.contains { $0.id == task.roomID })
        try await repository.complete(occurrenceID: visible[0].id, by: owner, at: boundary)
    }

    @Test func privateOwnerDepartureDoesNotAssignOtherResidents() throws {
        var state = state()
        var task = definition()
        task.visibility = .privateTask
        task.ownerUserID = MockSeed.currentUser.id
        _ = try service.create(task, at: date, state: &state)
        try service.removeMember(userID: MockSeed.currentUser.id, roomID: task.roomID, at: date, state: &state)
        #expect(state.definitions[0].rotationQueue.isEmpty)
        #expect(state.assignments.filter(\.isActive).count == 1)
        #expect(state.occurrences.filter { $0.availableAt >= boundary }.allSatisfy { $0.status == .available })
    }

    @Test func weeklyBoundaryUsesCalendarEvenAcrossDST() throws {
        for (zone, components) in [
            ("America/Sao_Paulo", DateComponents(year: 2026, month: 9, day: 20, hour: 23)),
            ("America/Sao_Paulo", DateComponents(year: 2026, month: 9, day: 21, hour: 0)),
            ("America/New_York", DateComponents(year: 2026, month: 10, day: 26, hour: 0))
        ] {
            var calendar = calendar
            calendar.timeZone = TimeZone(identifier: zone)!
            let date = calendar.date(from: components)!
            let service = TaskSchedulingService(calendar: calendar)
            var state = state()
            _ = try service.create(definition(), at: date, state: &state)
            let owner = state.assignments[0].userID
            try service.removeMember(userID: owner, roomID: MockSeed.kitchen.id, at: date, state: &state)
            let transition = state.roomMemberships.first { $0.roomID == MockSeed.kitchen.id && $0.userID == owner }!.rotationChanges!.last!
            #expect(transition.effectiveAt > date)
            #expect(calendar.component(.weekday, from: transition.effectiveAt) == 2)
            #expect(calendar.component(.hour, from: transition.effectiveAt) == 0)
            if zone == "America/New_York" { #expect(transition.effectiveAt.timeIntervalSince(date) == 169 * 3600) }
        }
    }

    @Test func repeatedAndConcurrentCommandsAreIdempotentAndRollbackInvalidState() async throws {
        var seed = MockSeed.make()
        seed.schedule = state()
        let store = MockStore(state: seed)
        let repository = MockTaskRepository(store: store, scheduling: service)
        let task = try await repository.create(definition(), at: date)
        let user = MockSeed.rafa.id
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<5 { group.addTask { try await repository.removeMember(userID: user, from: task.roomID, at: date) } }
            try await group.waitForAll()
        }
        let member = await store.read { $0.roomMemberships.first { $0.roomID == task.roomID && $0.userID == user }! }
        #expect(member.rotationChanges?.count == 1)
        await store.update { $0.roomMemberships.append(member) }
        let before = await store.read { $0.schedule }
        await #expect(throws: DomainError.invalidDistribution) {
            try await repository.addMember(userID: user, to: task.roomID, at: date)
        }
        let after = await store.read { $0.schedule }
        #expect(before.roomMemberships == after.roomMemberships)
        #expect(before.assignments == after.assignments)
        #expect(before.occurrences == after.occurrences)
    }

    @Test func snapshotRecurrenceAndAbsenceSurviveReplanning() throws {
        var state = state()
        var task = definition()
        task.recurrence = .recurring(frequency: .weekly, interval: 2)
        _ = try service.create(task, at: date, state: &state)
        let before = state.occurrences
        state.definitions[0].effort = TaskEffort(points: 1)
        let user = MockSeed.currentUser.id
        let membership = state.houseMemberships.first { $0.userID == user }!
        state.absences.append(try Absence(id: UUID(), membershipID: membership.id, startsAt: boundary,
            endsAt: calendar.date(byAdding: .weekOfYear, value: 20, to: boundary)!))
        try service.removeMember(userID: MockSeed.rafa.id, roomID: task.roomID, at: date, state: &state)
        for old in before {
            let new = state.occurrences.first { $0.id == old.id }!
            #expect(new.availableAt == old.availableAt)
            #expect(new.dueAt == old.dueAt)
            #expect(new.effortSnapshot == old.effortSnapshot)
        }
        #expect(!state.assignments.contains { $0.isActive && $0.userID == user && $0.assignedAt >= boundary })
    }

    @Test func creationDuringPendingChangeAndLegacyInitialization() throws {
        var state = state()
        try service.removeMember(userID: MockSeed.rafa.id, roomID: MockSeed.kitchen.id, at: date, state: &state)
        let saved = try service.create(definition(), at: date, state: &state)
        #expect(!saved.rotationQueue.contains(MockSeed.rafa.id))
        let legacy = definition(roomID: MockSeed.bathroom.id)
        state.definitions.append(legacy)
        let old = TaskOccurrence(id: UUID(), taskDefinitionID: legacy.id, availableAt: date, dueAt: boundary,
            status: .available, completedAt: nil, completedByUserID: nil, effortSnapshot: legacy.effort)
        state.occurrences.append(old)
        try service.addMember(userID: MockSeed.rafa.id, roomID: MockSeed.kitchen.id, at: date, state: &state)
        #expect(state.occurrences.first { $0.id == old.id } == old)
        #expect(state.definitions.first { $0.id == legacy.id }?.nextScheduledAt != nil)
        #expect(state.occurrences.contains { $0.taskDefinitionID == legacy.id && $0.availableAt == boundary })
    }

    @Test func newcomerCanClaimAndCompleteSporadicTaskBeforeRotationStarts() async throws {
        var seed = MockSeed.make()
        seed.schedule = state()
        let user = MockSeed.rafa.id
        seed.roomMemberships.removeAll { $0.roomID == MockSeed.kitchen.id && $0.userID == user }
        let store = MockStore(state: seed)
        let repository = MockTaskRepository(store: store, scheduling: service)
        var task = definition()
        task.kind = .sporadic
        task.recurrence = .none
        task.assignmentPolicy = .selfAssigned
        _ = try await repository.create(task, at: date)
        try await repository.addMember(userID: user, to: task.roomID, at: date)
        let occurrence = await store.read { $0.occurrences[0] }
        try await repository.claim(occurrenceID: occurrence.id, by: user, at: date)
        try await repository.complete(occurrenceID: occurrence.id, by: user, at: date)
        #expect(await store.read { $0.occurrences[0].isCompleted })
        let roomID = task.roomID
        #expect(await store.read { $0.roomMemberships.first { $0.roomID == roomID && $0.userID == user }?.fairnessDebt } == 2.25)
    }

    @Test func membershipChangeRebalancesOtherRoomsInTheHouse() throws {
        var state = state()
        let users = MockSeed.users.map(\.id)
        for room in [MockSeed.kitchen, MockSeed.bathroom, MockSeed.livingRoom, MockSeed.laundry] {
            _ = try service.create(definition(roomID: room.id), at: date, state: &state)
        }
        // Model a valid but poorly phased published schedule: all heavy work collides.
        for i in state.definitions.indices {
            state.definitions[i].rotationQueue = users
            state.definitions[i].currentRotationIndex = 0
            let occurrences = state.occurrences.filter { $0.taskDefinitionID == state.definitions[i].id }
                .sorted { $0.availableAt < $1.availableAt }
            for (turn, occurrence) in occurrences.enumerated() {
                let assignmentIndex = state.assignments.firstIndex { $0.occurrenceID == occurrence.id && $0.isActive }!
                let old = state.assignments[assignmentIndex]
                state.assignments[assignmentIndex] = TaskAssignment(id: old.id, occurrenceID: old.occurrenceID,
                    userID: users[turn % users.count], assignedAt: old.assignedAt, endedAt: nil)
            }
        }
        let before = state
        try service.removeMember(userID: MockSeed.rafa.id, roomID: MockSeed.kitchen.id, at: date, state: &state)
        let otherIDs = Set(state.definitions.filter { $0.roomID != MockSeed.kitchen.id }.map(\.id))
        let otherFutureIDs = Set(before.occurrences.filter {
            otherIDs.contains($0.taskDefinitionID) && $0.availableAt >= boundary
        }.map(\.id))
        #expect(state.assignments.contains { otherFutureIDs.contains($0.occurrenceID) && $0.supersededAt != nil })
        // Independent weekly effort calculation, restricted to the same published dates.
        func effortCost(_ state: TaskSchedulingState) -> Int {
            var loads: [Date: [UUID: Int]] = [:]
            for occurrence in before.occurrences where occurrence.availableAt >= boundary {
                if let owner = state.assignments.first(where: { $0.occurrenceID == occurrence.id && $0.isActive })?.userID {
                    loads[occurrence.availableAt, default: [:]][owner, default: 0] += occurrence.effortSnapshot.points
                }
            }
            return loads.values.reduce(0) { sum, users in sum + users.values.reduce(0) { $0 + $1 * $1 } }
        }
        #expect(effortCost(state) < effortCost(before))
        #expect(state.occurrences.filter { $0.availableAt < boundary } == before.occurrences.filter { $0.availableAt < boundary })
    }

    @Test func legacyRecordsDecodeWithoutNewOptionalFields() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let member = RoomMembership(id: UUID(), roomID: MockSeed.kitchen.id, userID: MockSeed.currentUser.id)
        let decoded = try decoder.decode(RoomMembership.self, from: encoder.encode(member))
        #expect(decoded.isCurrent)
        #expect(decoded.participates(at: date))
        #expect(decoded.rotationChanges == nil)
        let assignment = TaskAssignment(id: UUID(), occurrenceID: UUID(), userID: member.userID, assignedAt: date, endedAt: nil)
        #expect(try decoder.decode(TaskAssignment.self, from: encoder.encode(assignment)).isActive)
        #expect(try decoder.decode(TaskDefinition.self, from: encoder.encode(definition())).pendingRotation == nil)
    }

    @Test func weeklyLoadCountsSnapshotOnceAfterReassignmentAndCompletion() throws {
        var state = state()
        _ = try service.create(definition(), at: date, state: &state)
        try service.removeMember(userID: MockSeed.rafa.id, roomID: MockSeed.kitchen.id, at: date, state: &state)
        let next = state.occurrences.first { $0.availableAt == boundary }!
        let owner = state.assignments.first { $0.occurrenceID == next.id && $0.isActive }!.userID
        let calculator = WeeklyLoadCalculator()
        let pending = calculator.calculate(for: owner, assignments: state.assignments, occurrences: state.occurrences,
            referenceDate: boundary, calendar: calendar)
        try service.complete(occurrenceID: next.id, by: owner, at: boundary, state: &state)
        let completed = calculator.calculate(for: owner, assignments: state.assignments, occurrences: state.occurrences,
            referenceDate: boundary, calendar: calendar)
        #expect(pending == completed)
        #expect(pending.points == 3)
    }
}

struct HouseOptimizerTests {
    func permutations(_ values: [Int]) -> [[Int]] {
        if values.isEmpty { return [[]] }
        return values.flatMap { value in permutations(values.filter { $0 != value }).map { [value] + $0 } }
    }

    @Test func lexicographicHungarianMatchesExhaustiveOracle() throws {
        for n in 1...6 {
            for seed in 0..<5 {
                let matrix = (0..<n).map { row in (0..<n).map { col in
                    ScheduleCost(effort: Double((row * 13 + col * seed + 5) % 9),
                        difficulty: Double((row + col * 7) % 4), debt: Double(row * col - seed),
                        changes: row == col ? 0 : 1)
                } }
                let result = try HungarianAlgorithm().solve(costs: matrix)
                func cost(_ assignment: [Int]) -> ScheduleCost {
                    assignment.enumerated().reduce(ScheduleCost()) { $0 + matrix[$1.offset][$1.element] }
                }
                #expect(cost(result) == permutations(Array(0..<n)).map(cost).min())
            }
        }
    }

    @Test func houseOptimizationReducesWeeklyPeaksAndIsDeterministic() throws {
        let users = [UUID(), UUID(), UUID()]
        let turns = (0..<12).map { QueueForecast.Turn(week: $0, effort: 3, eligible: Set(users), incumbent: users[$0 % 3]) }
        let tasks = Array(repeating: QueueForecast(participants: users, turns: turns, existingQueue: users), count: 3)
        let optimizer = HouseQueueOptimizer()
        let result = try optimizer.optimize(tasks, fixed: [:], debts: [:])
        let before = try optimizer.score(tasks, queues: Array(repeating: users, count: 3), fixed: [:], debts: [:])
        let after = try optimizer.score(tasks, queues: result, fixed: [:], debts: [:])
        #expect(after.effort < before.effort)
        #expect(after.effort == 12 * 3 * 9)
        #expect(try optimizer.optimize(tasks, fixed: [:], debts: [:]) == result)
        #expect(result.allSatisfy { Set($0) == Set(users) })
    }

    @Test func singleQueueMatchesAllPermutationsWithFixedHouseLoad() throws {
        let users = [UUID(), UUID(), UUID(), UUID()]
        var weeks = Array(repeating: ProjectedWeek(), count: 12)
        for i in 0..<12 where i % 4 == 0 { weeks[i].add(effort: 3) }
        let fixed = [users[0]: weeks]
        let turns = (0..<12).map { QueueForecast.Turn(week: $0, effort: ($0 % 3) + 1, eligible: Set(users), incumbent: users[$0 % 4]) }
        let tasks = [QueueForecast(participants: users, turns: turns, existingQueue: users)]
        let optimizer = HouseQueueOptimizer()
        let result = try optimizer.optimize(tasks, fixed: fixed, debts: [:])
        let oracle = try permutations(Array(users.indices)).map { indices in
            try optimizer.score(tasks, queues: [indices.map { users[$0] }], fixed: fixed, debts: [:])
        }.min()!
        #expect(try optimizer.score(tasks, queues: result, fixed: fixed, debts: [:]) == oracle)
    }
}
