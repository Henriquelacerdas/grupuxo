import Foundation

/// Everything the task screen shows besides the definition and its room.
public struct TaskOverview: Hashable, Sendable {
    public let definition: TaskDefinition
    public let upcoming: [UpcomingAssignment]
    /// The occurrence that is available now and still open: the one "Mark as done" completes.
    public let current: TaskItem?
    /// The most recent completed occurrence, when the loaded history has one.
    public let lastCompleted: TaskItem?

    public init(
        definition: TaskDefinition,
        upcoming: [UpcomingAssignment],
        current: TaskItem?,
        lastCompleted: TaskItem?
    ) {
        self.definition = definition
        self.upcoming = upcoming
        self.current = current
        self.lastCompleted = lastCompleted
    }
}

public struct GetTaskOverviewUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        taskDefinitionID: TaskDefinition.ID,
        requesting userID: User.ID,
        at now: Date = .now
    ) async throws -> TaskOverview {
        let definition = try await repository.taskDefinition(id: taskDefinitionID, requesting: userID)

        // The history is secondary: a failure here must not hide the task itself.
        let items = (try? await repository.occurrences(of: taskDefinitionID, requesting: userID)) ?? []

        let current = items
            .filter { !$0.occurrence.isCompleted && $0.occurrence.availableAt <= now }
            .min {
                if $0.occurrence.availableAt != $1.occurrence.availableAt {
                    return $0.occurrence.availableAt < $1.occurrence.availableAt
                }
                return $0.id.uuidString < $1.id.uuidString
            }

        let lastCompleted = items
            .filter { $0.occurrence.isCompleted }
            .max {
                let left = $0.occurrence.completedAt ?? $0.occurrence.availableAt
                let right = $1.occurrence.completedAt ?? $1.occurrence.availableAt
                if left != right { return left < right }
                return $0.id.uuidString > $1.id.uuidString
            }

        return TaskOverview(
            definition: definition,
            upcoming: GetTaskUpcomingAssignmentsUseCase.assignments(from: items, at: now),
            current: current,
            lastCompleted: lastCompleted
        )
    }
}
