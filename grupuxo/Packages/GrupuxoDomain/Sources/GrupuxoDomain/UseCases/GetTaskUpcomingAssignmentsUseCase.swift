import Foundation

public struct UpcomingAssignment: Identifiable, Hashable, Sendable {
    public let occurrenceID: TaskOccurrence.ID
    public let assignee: User?
    public let availableAt: Date
    /// The occurrence is already available, so this person is responsible now.
    public let isCurrent: Bool

    public init(occurrenceID: TaskOccurrence.ID, assignee: User?, availableAt: Date, isCurrent: Bool) {
        self.occurrenceID = occurrenceID
        self.assignee = assignee
        self.availableAt = availableAt
        self.isCurrent = isCurrent
    }

    public var id: TaskOccurrence.ID { occurrenceID }
}

/// Queue of who does a task next, from the occurrences already scheduled. It starts at the
/// current responsible and ends before the rotation comes back to them, so one lap only.
public struct GetTaskUpcomingAssignmentsUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        taskDefinitionID: TaskDefinition.ID,
        requesting userID: User.ID,
        at now: Date = .now,
        limit: Int? = nil
    ) async throws -> [UpcomingAssignment] {
        let upcoming = try await repository.occurrences(of: taskDefinitionID, requesting: userID)
            .filter { !$0.occurrence.isCompleted }
            .sorted {
                if $0.occurrence.availableAt != $1.occurrence.availableAt {
                    return $0.occurrence.availableAt < $1.occurrence.availableAt
                }
                return $0.id.uuidString < $1.id.uuidString
            }
            .map {
                UpcomingAssignment(
                    occurrenceID: $0.occurrence.id,
                    assignee: $0.assignee,
                    availableAt: $0.occurrence.availableAt,
                    isCurrent: $0.occurrence.availableAt <= now
                )
            }
        let oneLap = Self.firstLap(of: upcoming)
        return limit.map { Array(oneLap.prefix(max($0, 0))) } ?? oneLap
    }

    /// Stops when the first responsible comes back after someone else took a turn. Consecutive
    /// turns by the same person (several executions per period) stay in the lap.
    private static func firstLap(of assignments: [UpcomingAssignment]) -> [UpcomingAssignment] {
        guard let anchor = assignments.lazy.compactMap({ $0.assignee?.id }).first else { return assignments }
        var sawOther = false
        var lap: [UpcomingAssignment] = []
        for assignment in assignments {
            if let id = assignment.assignee?.id {
                if id != anchor { sawOther = true } else if sawOther { break }
            }
            lap.append(assignment)
        }
        return lap
    }
}
