import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct TaskUpcomingAssignmentsTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func occurrence(
        _ definition: TaskDefinition,
        offset: TimeInterval,
        completed: Bool = false
    ) -> TaskOccurrence {
        TaskOccurrence(
            id: UUID(), taskDefinitionID: definition.id,
            availableAt: now.addingTimeInterval(offset), dueAt: nil,
            status: completed ? .completed : .available,
            completedAt: completed ? now : nil, completedByUserID: nil,
            effortSnapshot: definition.effort
        )
    }

    private func container(
        occurrences: (TaskDefinition, TaskDefinition) -> [TaskOccurrence]
    ) -> (AppContainer, [TaskDefinition]) {
        var seed = MockSeed.make()
        let definitions = Array(seed.definitions.filter {
            $0.roomID == MockSeed.kitchen.id && $0.kind != .sporadic
        }.prefix(2))
        seed.occurrences = occurrences(definitions[0], definitions[1])
        seed.assignments = []
        return (AppContainer(store: MockStore(state: seed)), definitions)
    }

    @Test func roomShowsOneItemPerDefinition() async throws {
        let (container, definitions) = container { first, second in
            [
                occurrence(first, offset: -200, completed: true),
                occurrence(first, offset: -100),
                occurrence(first, offset: 100),
                occurrence(second, offset: -100, completed: true),
                occurrence(second, offset: 100),
            ]
        }
        let items = try await GetRoomTasksUseCase(repository: container.taskRepository)(
            roomID: MockSeed.kitchen.id, userID: MockSeed.currentUser.id, at: now)
        #expect(items.count == 2)
        let byDefinition = Dictionary(uniqueKeysWithValues: items.map { ($0.definition.id, $0) })
        // Pending available wins over completed and future.
        #expect(byDefinition[definitions[0].id]?.occurrence.availableAt == now.addingTimeInterval(-100))
        #expect(byDefinition[definitions[0].id]?.occurrence.isCompleted == false)
        // Completed current stays visible until the next cycle.
        #expect(byDefinition[definitions[1].id]?.occurrence.isCompleted == true)
    }

    @Test func roomShowsNearestFutureWhenNothingIsAvailable() async throws {
        let (container, definitions) = container { first, second in
            [
                occurrence(first, offset: 300),
                occurrence(first, offset: 100),
                occurrence(second, offset: 50),
            ]
        }
        let items = try await GetRoomTasksUseCase(repository: container.taskRepository)(
            roomID: MockSeed.kitchen.id, userID: MockSeed.currentUser.id, at: now)
        let first = items.first { $0.definition.id == definitions[0].id }
        #expect(items.count == 2)
        #expect(first?.occurrence.availableAt == now.addingTimeInterval(100))
    }

    @Test func upcomingQueueIsOrderedExcludesCompletedAndRespectsLimit() async throws {
        let (container, definitions) = container { first, _ in
            [
                occurrence(first, offset: 300),
                occurrence(first, offset: -100, completed: true),
                occurrence(first, offset: 100),
                occurrence(first, offset: -10),
            ]
        }
        let useCase = GetTaskUpcomingAssignmentsUseCase(repository: container.taskRepository)
        let queue = try await useCase(
            taskDefinitionID: definitions[0].id, requesting: MockSeed.currentUser.id, at: now)
        #expect(queue.map(\.availableAt) == [-10, 100, 300].map { now.addingTimeInterval($0) })
        #expect(queue.map(\.isCurrent) == [true, false, false])
        #expect(queue.allSatisfy { $0.assignee == nil })

        let limited = try await useCase(
            taskDefinitionID: definitions[0].id, requesting: MockSeed.currentUser.id, at: now, limit: 2)
        #expect(limited.count == 2)
    }

    @Test func detailViewModelExposesUpcomingQueue() async throws {
        let container = AppContainer()
        let definition = try await container.store.read { state in
            try #require(state.definitions.first {
                $0.roomID == MockSeed.kitchen.id && $0.recurrence.isRepeating
            })
        }
        let session = AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house)
        let model = container.makeTaskDetailViewModel(taskDefinitionID: definition.id, session: session)
        await model.load()
        #expect(!model.upcoming.isEmpty)
        #expect(model.upcoming.map(\.availableAt) == model.upcoming.map(\.availableAt).sorted())
    }

    @Test func upcomingQueueStopsBeforeTheCycleRestarts() async throws {
        let (container, definitions) = container { first, _ in
            (0..<8).map { occurrence(first, offset: TimeInterval($0 * 100) - 10) }
        }
        let people = Array(MockSeed.users.prefix(3))
        try await container.store.update { state in
            let ids = state.occurrences.filter { $0.taskDefinitionID == definitions[0].id }
                .sorted { $0.availableAt < $1.availableAt }.map(\.id)
            for (index, id) in ids.enumerated() {
                state.assignments.append(TaskAssignment(
                    id: UUID(), occurrenceID: id, userID: people[index % 3].id,
                    assignedAt: Date(timeIntervalSince1970: 0), endedAt: nil, supersededAt: nil))
            }
        }
        let queue = try await GetTaskUpcomingAssignmentsUseCase(repository: container.taskRepository)(
            taskDefinitionID: definitions[0].id, requesting: MockSeed.currentUser.id, at: now)
        #expect(queue.map { $0.assignee?.id } == people.map(\.id))
        #expect(queue.first?.isCurrent == true)
    }
}
