import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

struct EndTaskTests {
    let date = Date(timeIntervalSince1970: 1_789_344_000)
    let me = MockSeed.currentUser.id

    private func fixture() -> (MockStore, MockTaskRepository, Calendar) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        var state = MockSeed.make()
        state.definitions = []; state.occurrences = []; state.assignments = []
        state.taskSwapRequests = []; state.notifications = []
        for i in state.rooms.indices {
            state.rooms[i].periodicity.executionsPerPeriod = 2
            state.rooms[i].calendarAnchor = nil
            state.rooms[i].scheduleVersions = []
        }
        let store = MockStore(state: state)
        return (store, MockTaskRepository(store: store, scheduling: TaskSchedulingService(calendar: calendar)), calendar)
    }

    private func recurring(
        _ name: String = "Limpar",
        policy: TaskAssignmentPolicy = .calendarRotation,
        recurrence: RecurrencePolicy = .recurring(frequency: .weekly, interval: 1)
    ) -> TaskDefinition {
        TaskDefinition(id: UUID(), roomID: MockSeed.kitchen.id, name: name, details: "", effort: TaskEffort(points: 2),
                       kind: .recurring, recurrence: recurrence, assignmentPolicy: policy)
    }

    private func occurrences(of definition: TaskDefinition, in store: MockStore) async -> [TaskOccurrence] {
        await store.read { $0.occurrences.filter { $0.taskDefinitionID == definition.id }.sorted { $0.availableAt < $1.availableAt } }
    }

    private func owner(of occurrence: TaskOccurrence, in store: MockStore) async -> User.ID {
        await store.read { state in state.assignments.first { $0.occurrenceID == occurrence.id && $0.isActive }!.userID }
    }

    @Test func keepsCurrentTurnAndHistoryAndRemovesOnlyFutureOnes() async throws {
        let (store, repository, _) = fixture()
        let task = recurring()
        _ = try await repository.create(task, requestedBy: me, at: date)
        let all = await occurrences(of: task, in: store)
        #expect(all.count == 4) // Só a próxima vez de cada morador.

        // A primeira ocorrência é concluída (histórico) e publica a próxima de quem concluiu; a segunda já está
        // disponível e fica pendente.
        let first = all[0], second = all[1]
        try await repository.complete(occurrenceID: first.id, by: await owner(of: first, in: store), at: date)
        let published = await occurrences(of: task, in: store)
        #expect(published.count == 5)
        let endedAt = second.availableAt.addingTimeInterval(3600)
        let before = await store.read { $0.schedule }

        try await repository.endTask(task.id, requestedBy: me, at: endedAt)

        let after = await store.read { $0.schedule }
        let kept = await occurrences(of: task, in: store)
        #expect(kept.map(\.id) == [first.id, second.id])
        #expect(kept[0].isCompleted && !kept[1].isCompleted)
        let removed = Set(published.dropFirst(2).map(\.id))
        #expect(!after.assignments.contains { removed.contains($0.occurrenceID) })
        #expect(after.assignments.filter { $0.occurrenceID == first.id } == before.assignments.filter { $0.occurrenceID == first.id })
        #expect(after.assignments.contains { $0.occurrenceID == second.id && $0.isActive })
        #expect(after.roomMemberships.map(\.fairnessDebt) == before.roomMemberships.map(\.fairnessDebt))
        #expect(after.definitions[0].endedAt == endedAt && after.definitions[0].nextScheduledAt == nil)

        // Nada novo é publicado, nem com o tempo, nem depois de concluir a vez atual.
        try await repository.refreshSchedule(in: MockSeed.house.id, at: endedAt.addingTimeInterval(86400 * 60))
        try await repository.complete(
            occurrenceID: second.id, by: await owner(of: second, in: store), at: endedAt.addingTimeInterval(7200)
        )
        #expect(await occurrences(of: task, in: store).count == 2)
        #expect(await store.read { $0.schedule.definitions[0].endedAt } == endedAt)
    }

    @Test func afterCompletionDoesNotPublishSuccessorOnceEnded() async throws {
        let (store, repository, _) = fixture()
        let task = recurring(policy: .afterCompletion)
        _ = try await repository.create(task, requestedBy: me, at: date)
        let current = try #require(await occurrences(of: task, in: store).first)

        try await repository.endTask(task.id, requestedBy: me, at: date.addingTimeInterval(60))
        #expect(await occurrences(of: task, in: store).count == 1)   // a vez atual fica

        try await repository.complete(
            occurrenceID: current.id, by: await owner(of: current, in: store), at: date.addingTimeInterval(120)
        )
        let final = await occurrences(of: task, in: store)
        #expect(final.count == 1 && final[0].isCompleted)
    }

    @Test func isIdempotentAndKeepsTheFirstEndDate() async throws {
        let (store, repository, _) = fixture()
        let task = recurring()
        _ = try await repository.create(task, requestedBy: me, at: date)
        try await repository.endTask(task.id, requestedBy: me, at: date)
        let once = await store.read { $0.schedule }
        try await repository.endTask(task.id, requestedBy: me, at: date.addingTimeInterval(86400))
        let twice = await store.read { $0.schedule }
        #expect(twice.definitions == once.definitions)
        #expect(twice.occurrences == once.occurrences && twice.assignments == once.assignments)
    }

    @Test func requiresHouseMemberCurrentlyInTheRoomAndDoesNotMutate() async throws {
        let (store, repository, _) = fixture()
        let task = recurring()
        _ = try await repository.create(task, requestedBy: me, at: date)
        let before = await store.read { $0.schedule }

        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.endTask(task.id, requestedBy: UUID(), at: date)   // fora da casa
        }
        await store.update { $0.roomMemberships.removeAll { $0.roomID == task.roomID && $0.userID == me } }
        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.endTask(task.id, requestedBy: me, at: date)       // fora do cômodo
        }
        await #expect(throws: DomainError.entityNotFound) {
            try await repository.endTask(UUID(), requestedBy: me, at: date)
        }
        let after = await store.read { $0.schedule }
        #expect(after.definitions == before.definitions && after.occurrences == before.occurrences)
    }

    @Test func sporadicTasksCannotBeEnded() async throws {
        let (_, repository, _) = fixture()
        var task = recurring()
        task.kind = .sporadic; task.recurrence = .none; task.assignmentPolicy = .selfAssigned
        _ = try await repository.create(task, requestedBy: me, at: date)
        await #expect(throws: DomainError.taskUnavailable) {
            try await repository.endTask(task.id, requestedBy: me, at: date)
        }
    }

    @Test func pendingSwapsOnRemovedOccurrencesAreRejectedWithNotice() async throws {
        let (store, repository, _) = fixture()
        let ending = recurring("Encerrar"), other = recurring("Outra")
        _ = try await repository.create(ending, requestedBy: me, at: date)
        _ = try await repository.create(other, requestedBy: me, at: date)
        let endingOccurrences = await occurrences(of: ending, in: store)
        let otherOccurrences = await occurrences(of: other, in: store)
        let endedAt = endingOccurrences[1].availableAt.addingTimeInterval(3600)
        let users = await store.read { $0.users.map(\.id) }

        func swap(_ offered: TaskOccurrence, _ requested: TaskOccurrence) -> TaskSwapRequest {
            TaskSwapRequest(id: UUID(), requesterID: users[0], receiverID: users[1], offeredOccurrenceID: offered.id,
                            requestedOccurrenceID: requested.id, status: .pending, createdAt: date, resolvedAt: nil)
        }
        let touchesRemoved = swap(endingOccurrences[1], endingOccurrences[3])
        let removedOnRequestedSide = swap(otherOccurrences[0], endingOccurrences[2])
        let keptOnly = swap(endingOccurrences[1], otherOccurrences[1])
        await store.update { $0.taskSwapRequests = [touchesRemoved, removedOnRequestedSide, keptOnly] }
        let othersBefore = await occurrences(of: other, in: store)

        try await repository.endTask(ending.id, requestedBy: me, at: endedAt)

        let state = await store.read { $0 }
        func status(_ request: TaskSwapRequest) -> TaskSwapRequestStatus {
            state.taskSwapRequests.first { $0.id == request.id }!.status
        }
        #expect(status(touchesRemoved) == .rejected && status(removedOnRequestedSide) == .rejected)
        #expect(status(keptOnly) == .pending)
        #expect(state.taskSwapRequests.first { $0.id == touchesRemoved.id }?.resolvedAt == endedAt)
        let notices = state.notifications.filter { $0.kind == .taskSwapRejected }
        #expect(Set(notices.compactMap(\.swapRequestID)) == [touchesRemoved.id, removedOnRequestedSide.id])
        #expect(notices.allSatisfy { $0.recipientUserID == users[0] && $0.message?.contains("Encerrar") == true })
        // Sem rebalance: as demais tarefas não mudam.
        #expect(await occurrences(of: other, in: store) == othersBefore)
        // Quem ia receber não vê mais a troca como pendente (e a consulta continua funcionando).
        let incoming = try await MockTaskSwapRepository(store: store).incomingRequests(for: users[1], in: MockSeed.house.id)
        #expect(incoming.filter(\.isPending).map(\.id) == [keptOnly.id])
    }

    @Test func roomListHidesCompletedTurnsOfEndedTasksButKeepsTheCurrentOne() async throws {
        let (store, repository, _) = fixture()
        let task = recurring()
        _ = try await repository.create(task, requestedBy: me, at: date)
        let all = await occurrences(of: task, in: store)
        try await repository.complete(occurrenceID: all[0].id, by: await owner(of: all[0], in: store), at: date)
        let endedAt = all[1].availableAt.addingTimeInterval(3600)
        try await repository.endTask(task.id, requestedBy: me, at: endedAt)

        let listed = try await repository.tasks(in: task.roomID, requesting: me)
        #expect(listed.map(\.occurrence.id) == [all[1].id])

        try await repository.complete(
            occurrenceID: all[1].id, by: await owner(of: all[1], in: store), at: endedAt.addingTimeInterval(60)
        )
        #expect(try await repository.tasks(in: task.roomID, requesting: me).isEmpty)
    }

    @Test func endingARoomLinkedTaskLeavesTheOtherOneUntouched() async throws {
        let (store, repository, _) = fixture()
        let linked = WeeklyPeriodicity(executionsPerPeriod: 2)
        let ending = recurring("Ligada A", recurrence: .weekly(linked))
        let other = recurring("Ligada B", recurrence: .weekly(linked))
        _ = try await repository.create(ending, requestedBy: me, at: date)
        _ = try await repository.create(other, requestedBy: me, at: date)
        let otherBefore = await occurrences(of: other, in: store)
        let endingAll = await occurrences(of: ending, in: store)

        try await repository.endTask(ending.id, requestedBy: me, at: date.addingTimeInterval(60))
        try await repository.refreshSchedule(in: MockSeed.house.id, at: date.addingTimeInterval(86400 * 70))

        let endingKept = await occurrences(of: ending, in: store)
        #expect(endingKept.allSatisfy { $0.availableAt <= date.addingTimeInterval(60) })
        #expect(endingKept.count < endingAll.count)
        let otherAfter = await occurrences(of: other, in: store)
        // A outra não perdeu nem mudou nada; só ganhou as vezes seguintes de quem atrasou.
        #expect(otherBefore.allSatisfy { otherAfter.contains($0) })
        #expect(otherAfter.count > otherBefore.count)
    }
}
