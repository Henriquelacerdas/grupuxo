import Foundation
import Testing
@testable import grupuxo

struct DistributionTests {
    let engine = TaskDistributionEngine()
    let solver = HungarianAlgorithm()

    @Test func knownOptimumAndNegativeCosts() throws {
        #expect(try solver.solve(matrix: [[4, 1, 3], [2, 0, 5], [3, 2, 2]]) == [1, 0, 2])
        #expect(try solver.solve(matrix: [[-4, -1], [-2, -5]]) == [0, 1])
        #expect(try solver.solve(matrix: []) == [])
        #expect(try solver.solve(matrix: [[3]]) == [0])
        #expect(try solver.solve(matrix: [[0, 0], [0, 0]]) == [0, 1])
    }

    @Test func malformedMatricesFail() {
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[1, 2]]) }
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[.nan]]) }
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[.infinity]]) }
    }

    @Test func optimumMatchesExhaustiveSearch() throws {
        // Independent oracle over every permutation, several sizes and negative/tied costs.
        for n in 1...6 {
            for seed in 0..<8 {
                let matrix = (0..<n).map { row in
                    (0..<n).map { col in Double(((row + 3) * (col + seed + 1) * 17 + col * col) % 29 - 14) }
                }
                let assignment = try solver.solve(matrix: matrix)
                let cost = assignment.enumerated().reduce(0.0) { $0 + matrix[$1.offset][$1.element] }
                let oracle = permutations(Array(0..<n)).map { candidate in
                    candidate.enumerated().reduce(0.0) { $0 + matrix[$1.offset][$1.element] }
                }.min()!
                #expect(cost == oracle)
                #expect(Set(assignment).count == n)
            }
        }
    }

    @Test func weeklyPeaksDeterminePhase() throws {
        let a = UUID(), b = UUID()
        var aWeeks = Array(repeating: ProjectedWeek(), count: 12)
        var bWeeks = aWeeks
        for week in 0..<12 {
            if week.isMultiple(of: 2) { aWeeks[week].add(effort: 3) }
            else { bWeeks[week].add(effort: 3) }
        }
        let queue = try engine.generateInitialQueue(taskEffort: 3, participants: [a, b],
                                                    occurrenceWeeks: Array(0..<12),
                                                    projection: [a: aWeeks, b: bWeeks], debts: [:])
        #expect(queue == [b, a])
    }

    @Test func positiveDebtDelaysFirstTurnAndQueueIsPermutation() throws {
        let a = UUID(), b = UUID(), c = UUID()
        let queue = try engine.generateInitialQueue(taskEffort: 2, participants: [a, b, c],
                                                    occurrenceWeeks: [0], projection: [:], debts: [a: 12, b: -12])
        #expect(queue.first == b)
        #expect(Set(queue) == Set([a, b, c]))
        #expect(queue.count == 3)
    }

    @Test func fairnessIsZeroSumAndDeduplicatesMembers() throws {
        let a = UUID(), b = UUID(), c = UUID()
        let result = try FairnessCalculator().calculateDebtImpact(effort: 2, executorID: a,
                                                                  eligibleUserIDs: [a, b, c, a])
        #expect(abs(result.values.reduce(0, +)) < 1e-12)
        #expect(abs(result[a]! - 4.0 / 3) < 1e-12)
        #expect(result[b] == result[c])
        #expect(throws: DomainError.invalidDistribution) {
            try FairnessCalculator().calculateDebtImpact(effort: 2, executorID: UUID(), eligibleUserIDs: [a])
        }
        #expect(try FairnessCalculator().calculateDebtImpact(effort: 3, executorID: a, eligibleUserIDs: [a]) == [a: 0])
    }

    @Test func difficultyMixBreaksEqualLoadTie() throws {
        let a = UUID(), b = UUID()
        var aWeeks = Array(repeating: ProjectedWeek(), count: 12)
        var bWeeks = aWeeks
        aWeeks[0].add(effort: 3)
        for _ in 0..<3 { bWeeks[0].add(effort: 1) }
        let queue = try engine.generateInitialQueue(taskEffort: 3, participants: [a, b],
                                                    occurrenceWeeks: [0], projection: [a: aWeeks, b: bWeeks], debts: [:])
        #expect(queue.first == b)
    }

    @Test func invalidEngineInputsFail() {
        let a = UUID()
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a, a],
                                             occurrenceWeeks: [0], projection: [:], debts: [:])
        }
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a],
                                             occurrenceWeeks: [12], projection: [:], debts: [:])
        }
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a],
                                             occurrenceWeeks: [0], projection: [:], debts: [a: .nan])
        }
    }

    private func permutations(_ values: [Int]) -> [[Int]] {
        guard let first = values.first else { return [[]] }
        return permutations(Array(values.dropFirst())).flatMap { tail in
            (0...tail.count).map { index in
                var result = tail
                result.insert(first, at: index)
                return result
            }
        }
    }
}

struct SchedulingTests {
    let date = Date(timeIntervalSince1970: 1_789_344_000) // Deterministic reference, never wall clock.

    private func fixture() -> (MockStore, MockTaskRepository, TaskDefinition, Calendar) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        var state = MockSeed.make()
        state.definitions = []; state.occurrences = []; state.assignments = []
        for i in state.rooms.indices { state.rooms[i].periodicity.executionsPerPeriod = 2; state.rooms[i].calendarAnchor = nil; state.rooms[i].scheduleVersions = [] }
        let store = MockStore(state: state)
        let repository = MockTaskRepository(store: store, scheduling: TaskSchedulingService(calendar: calendar))
        let definition = TaskDefinition(id: UUID(), roomID: MockSeed.kitchen.id, name: "Limpar", details: "",
                                        effort: TaskEffort(points: 3), kind: .recurring,
                                        recurrence: .recurring(frequency: .weekly, interval: 1), assignmentPolicy: .calendarRotation)
        return (store, repository, definition, calendar)
    }

    @Test func createsTwelveWeeksAndRefreshesWithoutDuplicates() async throws {
        let (store, repository, definition, calendar) = fixture()
        let created = try await CreateTaskUseCase(
            repository: repository,
            roomRepository: MockRoomRepository(store: store)
        )(definition: definition, requestedBy: MockSeed.currentUser.id, date: date)
        let initial = await store.read { $0.schedule }
        #expect(initial.occurrences.count == 12)
        #expect(initial.assignments.count == 12)
        #expect(Set(created.rotationQueue).count == 4)
        #expect(created.currentRotationIndex == 0)
        #expect(initial.occurrences.first?.availableAt == date)
        #expect(initial.occurrences.dropFirst().allSatisfy { calendar.component(.weekday, from: $0.availableAt) == 2 })
        let future = calendar.date(byAdding: .weekOfYear, value: 5, to: date)!
        try await repository.refreshSchedule(in: MockSeed.house.id, at: future)
        try await repository.refreshSchedule(in: MockSeed.house.id, at: future)
        let final = await store.read { $0.schedule }
        #expect(final.occurrences.count == 17)
        #expect(final.assignments.count == 17)
        #expect(Array(final.occurrences.prefix(12)) == initial.occurrences)
        #expect(Set(final.occurrences.map(\.availableAt)).count == 17)
        #expect(final.definitions[0].currentRotationIndex == 1)
        let repeatCreate = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: future)
        #expect(repeatCreate == final.definitions[0])
    }

    @Test func biweeklyAndLongIntervals() async throws {
        for (interval, count) in [(2, 6), (20, 1)] {
            let (store, repository, original, _) = fixture()
            var definition = original
            definition.recurrence = .recurring(frequency: .weekly, interval: interval)
            _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
            #expect(await store.read { $0.occurrences.count } == count)
        }
    }

    @Test func schedulesDailyMonthlyAndYearlyRecurrences() async throws {
        let (dailyStore, dailyRepository, original, calendar) = fixture()
        var daily = original
        daily.recurrence = .recurring(frequency: .daily, interval: 2)
        _ = try await dailyRepository.create(daily, requestedBy: MockSeed.currentUser.id, at: date)
        let dailyOccurrences = await dailyStore.read { $0.occurrences }
        #expect(dailyOccurrences[1].availableAt == calendar.date(byAdding: .day, value: 2, to: date))

        let (monthlyStore, monthlyRepository, monthlyOriginal, _) = fixture()
        var monthly = monthlyOriginal
        monthly.recurrence = .recurring(frequency: .monthly, interval: 3)
        let savedMonthly = try await monthlyRepository.create(monthly, requestedBy: MockSeed.currentUser.id, at: date)
        let monthlyOccurrences = await monthlyStore.read { $0.occurrences }
        #expect(monthlyOccurrences.count == 1) // Three months exceed the 12-week publication horizon.
        #expect(savedMonthly.nextScheduledAt == calendar.date(byAdding: .month, value: 3, to: date))

        let (_, yearlyRepository, yearlyOriginal, _) = fixture()
        var yearly = yearlyOriginal
        yearly.recurrence = .recurring(frequency: .yearly, interval: 1)
        let savedYearly = try await yearlyRepository.create(yearly, requestedBy: MockSeed.currentUser.id, at: date)
        #expect(savedYearly.nextScheduledAt == calendar.date(byAdding: .year, value: 1, to: date))
    }

    @Test func concurrentCompletionIsAtomicAndUsesSnapshot() async throws {
        let (store, repository, definition, _) = fixture()
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let first = await store.read { $0.assignments[0] }
        await store.update { $0.definitions[0].effort = TaskEffort(points: 1) }
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<20 {
                group.addTask { try await repository.complete(occurrenceID: first.occurrenceID, by: first.userID, at: date) }
            }
            try await group.waitForAll()
        }
        let state = await store.read { $0.schedule }
        let memberships = state.roomMemberships.filter { $0.roomID == definition.roomID }
        #expect(memberships.first { $0.userID == first.userID }?.fairnessDebt == 2.25)
        #expect(memberships.filter { $0.userID != first.userID }.allSatisfy { $0.fairnessDebt == -0.75 })
        #expect(state.roomMemberships.filter { $0.roomID != definition.roomID }.allSatisfy { $0.fairnessDebt == 0 })
        #expect(state.occurrences.filter(\.isCompleted).count == 1)
        #expect(state.assignments.filter { $0.occurrenceID == first.occurrenceID && $0.isActive }.isEmpty)
        #expect(state.definitions[0].currentRotationIndex == 0) // Calendar cursor does not advance on completion.
    }

    @Test func unauthorizedAndFutureCompletionsDoNotMutate() async throws {
        let (store, repository, definition, _) = fixture()
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let before = await store.read { $0.schedule }
        let first = before.assignments[0]
        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.complete(occurrenceID: first.occurrenceID, by: UUID(), at: date)
        }
        let future = before.assignments[1]
        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.complete(occurrenceID: future.occurrenceID, by: future.userID, at: date)
        }
        let after = await store.read { $0.schedule }
        #expect(before.occurrences == after.occurrences)
        #expect(before.roomMemberships == after.roomMemberships)
        #expect(before.assignments == after.assignments)
    }

    @Test func transactionRollsBackMutationsBeforeThrow() async {
        let (store, _, _, _) = fixture()
        let before = await store.read { $0.roomMemberships }
        await #expect(throws: DomainError.invalidDistribution) {
            try await store.update { state in
                state.roomMemberships[0].fairnessDebt = 123
                state.occurrences.removeAll()
                throw DomainError.invalidDistribution
            }
        }
        #expect(await store.read { $0.roomMemberships } == before)
    }

    @Test func afterCompletionPublishesOnlyOneSuccessor() async throws {
        let (store, repository, original, _) = fixture()
        var definition = original
        definition.assignmentPolicy = .afterCompletion
        let saved = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let initial = await store.read { $0.schedule }
        #expect(initial.occurrences.count == 1)
        #expect(saved.recurrence == .none)
        #expect(saved.currentRotationIndex == 1)
        let first = initial.assignments[0]
        try await CompleteTaskUseCase(repository: repository)(occurrenceID: first.occurrenceID, userID: first.userID, date: date)
        try await repository.complete(occurrenceID: first.occurrenceID, by: first.userID, at: date)
        let final = await store.read { $0.schedule }
        #expect(final.occurrences.count == 2)
        #expect(final.occurrences.filter { !$0.isCompleted }.count == 1)
        #expect(final.assignments.last?.userID == saved.rotationQueue[1])
        #expect(final.definitions[0].currentRotationIndex == 2)
    }

    @Test func sporadicCompletionUsesFairnessWithoutRecurrence() async throws {
        let (store, repository, original, _) = fixture()
        var definition = original
        definition.kind = .sporadic; definition.recurrence = .none; definition.assignmentPolicy = .selfAssigned
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let occurrence = await store.read { $0.occurrences[0] }
        try await repository.claim(occurrenceID: occurrence.id, by: MockSeed.currentUser.id, at: date)
        try await repository.claim(occurrenceID: occurrence.id, by: MockSeed.currentUser.id, at: date)
        try await repository.complete(occurrenceID: occurrence.id, by: MockSeed.currentUser.id, at: date)
        let state = await store.read { $0.schedule }
        #expect(state.occurrences.count == 1)
        #expect(state.assignments.count == 1)
        #expect(state.definitions[0].rotationQueue.isEmpty)
        #expect(state.roomMemberships.first { $0.roomID == definition.roomID && $0.userID == MockSeed.currentUser.id }?.fairnessDebt == 2.25)
    }

    @Test func concurrentCreatesSeeCommittedHouseLoad() async throws {
        let (store, repository, definition, _) = fixture()
        let second = TaskDefinition(id: UUID(), roomID: definition.roomID, name: "Segunda", details: "",
                                    effort: definition.effort, kind: .recurring,
                                    recurrence: definition.recurrence, assignmentPolicy: definition.assignmentPolicy)
        async let a = repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        async let b = repository.create(second, requestedBy: MockSeed.currentUser.id, at: date)
        let (firstSaved, secondSaved) = try await (a, b)
        #expect(firstSaved.rotationQueue[0] != secondSaved.rotationQueue[0])
        #expect(await store.read { $0.occurrences.count } == 24)
    }

    @Test func membershipInsertionReplansNextWeekAndPreservesCurrentWeek() async throws {
        let (store, repository, definition, calendar) = fixture()
        await store.update { state in
            state.roomMemberships.removeAll { $0.roomID == definition.roomID && $0.userID == MockSeed.rafa.id }
        }
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let before = await store.read { $0.schedule }
        try await AddRoomMemberUseCase(repository: repository)(userID: MockSeed.rafa.id, roomID: definition.roomID, date: date)
        let after = await store.read { $0.schedule }
        try await repository.addMember(userID: MockSeed.rafa.id, to: definition.roomID, at: date)
        #expect(await store.read { $0.assignments } == after.assignments)
        let boundary = calendar.date(byAdding: .weekOfYear, value: 1, to: calendar.dateInterval(of: .weekOfYear, for: date)!.start)!
        #expect(after.definitions[0].rotationQueue.count == 4)
        #expect(after.occurrences.filter { $0.availableAt < boundary } == before.occurrences.filter { $0.availableAt < boundary })
        #expect(after.assignments.first { $0.occurrenceID == before.occurrences[0].id && $0.isActive } == before.assignments[0])
        #expect(after.occurrences.prefix(before.occurrences.count).map(\.id) == before.occurrences.map(\.id))
        #expect(after.assignments.contains { $0.userID == MockSeed.rafa.id && $0.isActive && $0.assignedAt < before.definitions[0].nextScheduledAt! })
        #expect(after.assignments.contains { $0.supersededAt == date })
        #expect(after.assignments.allSatisfy { $0.endedAt == nil || $0.endedAt! >= $0.assignedAt })
        #expect(after.roomMemberships.filter { $0.roomID == definition.roomID && $0.userID == MockSeed.rafa.id }.count == 1)
    }

    @Test func invalidRecurrenceAndEmptyMembershipDoNotPartiallyCreate() async throws {
        let (store, repository, original, _) = fixture()
        var definition = original
        definition.recurrence = .recurring(frequency: .weekly, interval: 0)
        await #expect(throws: DomainError.invalidSchedule) {
            try await CreateTaskUseCase(
                repository: repository,
                roomRepository: MockRoomRepository(store: store)
            )(definition: definition, requestedBy: MockSeed.currentUser.id, date: date)
        }
        #expect(await store.read { $0.definitions.isEmpty && $0.occurrences.isEmpty && $0.assignments.isEmpty })
        definition.recurrence = .recurring(frequency: .weekly, interval: 1)
        await store.update { $0.roomMemberships.removeAll { $0.roomID == original.roomID } }
        await #expect(throws: DomainError.taskUnavailable) { try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date) }
        #expect(await store.read { $0.definitions.isEmpty && $0.occurrences.isEmpty && $0.assignments.isEmpty })
    }

    @Test func taskCreationRequiresRoomMembership() async throws {
        let (store, repository, definition, _) = fixture()
        await store.update { $0.roomMemberships.removeAll { $0.roomID == definition.roomID && $0.userID == MockSeed.currentUser.id } }
        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        }
    }
    @Test func calendarSurvivesDaylightSavingBoundary() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let first = calendar.date(from: DateComponents(year: 2026, month: 10, day: 26))!
        let (store, _, definition, _) = fixture()
        let repository = MockTaskRepository(store: store, scheduling: TaskSchedulingService(calendar: calendar))
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: first)
        let occurrences = await store.read { $0.occurrences }
        #expect(occurrences[1].availableAt.timeIntervalSince(first) == 169 * 3600)
        #expect(occurrences.allSatisfy { calendar.component(.hour, from: $0.availableAt) == 0 })
        #expect(occurrences.allSatisfy { calendar.component(.weekday, from: $0.availableAt) == 2 })
    }

    @Test func absenceIsExcludedFromCompletionDebt() async throws {
        let (store, repository, definition, _) = fixture()
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let first = await store.read { $0.assignments[0] }
        let absent = await store.read { $0.houseMemberships.first { $0.userID != first.userID }! }
        let absence = try Absence(id: UUID(), membershipID: absent.id,
                                  startsAt: date.addingTimeInterval(-1), endsAt: date.addingTimeInterval(3600))
        await store.update { $0.absences.append(absence) }
        try await repository.complete(occurrenceID: first.occurrenceID, by: first.userID, at: date)
        let memberships = await store.read { $0.roomMemberships.filter { $0.roomID == definition.roomID } }
        #expect(memberships.first { $0.userID == first.userID }?.fairnessDebt == 2)
        #expect(memberships.first { $0.userID == absent.userID }?.fairnessDebt == 0)
        #expect(memberships.reduce(0) { $0 + $1.fairnessDebt } == 0)
    }

    @Test func duplicateMembershipRollsBackCompletion() async throws {
        let (store, repository, definition, _) = fixture()
        _ = try await repository.create(definition, requestedBy: MockSeed.currentUser.id, at: date)
        let first = await store.read { $0.assignments[0] }
        await store.update { $0.roomMemberships.append(RoomMembership(id: UUID(), roomID: definition.roomID, userID: first.userID)) }
        let before = await store.read { $0.schedule }
        await #expect(throws: DomainError.invalidDistribution) {
            try await repository.complete(occurrenceID: first.occurrenceID, by: first.userID, at: date)
        }
        let after = await store.read { $0.schedule }
        #expect(before.occurrences == after.occurrences)
        #expect(before.assignments == after.assignments)
        #expect(before.roomMemberships == after.roomMemberships)
    }

    @Test @MainActor func editorChoicesProduceValidCommands() async throws {
        let (store, repository, _, _) = fixture()
        let viewModel = TaskEditorViewModel(createTask: CreateTaskUseCase(
                                                repository: repository,
                                                roomRepository: MockRoomRepository(store: store)
                                            ),
                                            getHouseRooms: GetHouseRoomsUseCase(repository: MockRoomRepository(store: store)),
                                            houseID: MockSeed.house.id, requestingUserID: MockSeed.currentUser.id,
                                            draft: TaskDraft())
        viewModel.updateDraft { $0.name = "Avulsa"; $0.roomID = MockSeed.kitchen.id }
        viewModel.selectRecurrence(.recurring(frequency: .monthly, interval: 3))
        #expect(viewModel.state.draft.kind == .recurring)
        #expect(viewModel.state.draft.recurrence == .recurring(frequency: .monthly, interval: 3))
        viewModel.updateDraft { $0.recurrence = .none }
        #expect(viewModel.state.draft.kind == .sporadic)
        #expect(viewModel.state.draft.assignmentPolicy == .selfAssigned)
        await viewModel.save()
        guard case let .saved(definition) = viewModel.state else { Issue.record("Editor failed to save a sporadic task"); return }
        #expect(definition.kind == .sporadic)
        #expect(await store.read { $0.occurrences.count } == 1)
        viewModel.updateDraft { $0.assignmentPolicy = .afterCompletion }
        #expect(viewModel.state.draft.kind == .recurring)
        #expect(viewModel.state.draft.recurrence == .none)
        viewModel.updateDraft { $0.assignmentPolicy = .calendarRotation }
        #expect(viewModel.state.draft.recurrence == .recurring(frequency: .weekly, interval: 1))
    }

}

@MainActor
struct TaskListPresentationTests {
    @Test func deadlinesSortAscendingWithUndatedTasksLast() async throws {
        var seed = MockSeed.make()
        let roomID = MockSeed.kitchen.id
        let definition = seed.definitions.first { $0.roomID == roomID }!
        let dates: [Date?] = [nil, Date(timeIntervalSince1970: 300), Date(timeIntervalSince1970: 100)]
        seed.occurrences = dates.map {
            TaskOccurrence(id: UUID(), taskDefinitionID: definition.id, availableAt: .distantPast,
                           dueAt: $0, status: .available, completedAt: nil, completedByUserID: nil,
                           effortSnapshot: definition.effort)
        }
        let container = AppContainer(store: MockStore(state: seed))
        let tasks = try await GetRoomTasksUseCase(repository: container.taskRepository)(
            roomID: roomID, userID: MockSeed.currentUser.id)
        #expect(tasks.map(\.occurrence.dueAt) == [dates[2], dates[1], nil])
    }

    @Test func completionKeepsResidentAndUpdatesRoomState() async throws {
        let container = AppContainer()
        let user = try await container.store.read { state in
            let ids = Set(state.definitions.filter { $0.roomID == MockSeed.kitchen.id }.map(\.id))
            let occurrence = try #require(state.occurrences.first { ids.contains($0.taskDefinitionID) && $0.availableAt <= .now })
            let owner = try #require(state.assignments.first { $0.occurrenceID == occurrence.id && $0.isActive }?.userID)
            return try #require(state.users.first { $0.id == owner })
        }
        let session = AppSession(currentUser: user, currentHouse: MockSeed.house)
        let model = container.makeRoomDetailViewModel(roomID: MockSeed.kitchen.id, session: session)
        await model.load()
        guard case let .content(content) = model.state,
              let item = content.tasks.first(where: { $0.assignment?.userID == user.id && $0.occurrence.availableAt <= .now }) else {
            Issue.record("Missing assigned task")
            return
        }
        #expect(item.assignee == user)
        #expect(model.canComplete(item))
        await model.complete(item.id)
        #expect(model.actionError == nil)
        guard case let .content(updated) = model.state,
              let completed = updated.tasks.first(where: { $0.id == item.id }) else {
            Issue.record("Missing completed task")
            return
        }
        #expect(completed.occurrence.isCompleted)
        #expect(completed.assignee == user)
        #expect(!model.canComplete(completed))
    }

    @Test func profileLoadsAllResidentsAndRejectsOutsiders() async throws {
        let container = AppContainer()
        let useCase = GetHouseMembersUseCase(repository: container.houseRepository)
        let members = try await useCase(houseID: MockSeed.house.id, userID: MockSeed.currentUser.id)
        #expect(Set(members.map(\.id)) == Set(MockSeed.users.map(\.id)))
        do {
            _ = try await useCase(houseID: MockSeed.house.id, userID: UUID())
            Issue.record("An outsider could read the resident list")
        } catch {
            #expect(error as? DomainError == .taskUnavailable)
        }
    }
}
