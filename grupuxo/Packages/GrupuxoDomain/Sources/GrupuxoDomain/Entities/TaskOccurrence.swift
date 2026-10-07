import Foundation

public struct TaskOccurrence: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let taskDefinitionID: TaskDefinition.ID
    public var availableAt: Date
    public var dueAt: Date?
    public var status: TaskOccurrenceStatus
    public var completedAt: Date?
    public var completedByUserID: User.ID?
    public var completionDebtImpacts: [User.ID: Double]? = nil
    public var didPublishSuccessor: Bool? = nil
    public let effortSnapshot: TaskEffort

    public init(
        id: UUID,
        taskDefinitionID: TaskDefinition.ID,
        availableAt: Date,
        dueAt: Date?,
        status: TaskOccurrenceStatus,
        completedAt: Date?,
        completedByUserID: User.ID?,
        completionDebtImpacts: [User.ID: Double]? = nil,
        didPublishSuccessor: Bool? = nil,
        effortSnapshot: TaskEffort
    ) {
        self.id = id
        self.taskDefinitionID = taskDefinitionID
        self.availableAt = availableAt
        self.dueAt = dueAt
        self.status = status
        self.completedAt = completedAt
        self.completedByUserID = completedByUserID
        self.completionDebtImpacts = completionDebtImpacts
        self.didPublishSuccessor = didPublishSuccessor
        self.effortSnapshot = effortSnapshot
    }

    public nonisolated var isCompleted: Bool { status == .completed }
}

public struct TaskItem: Identifiable, Hashable, Sendable {
    public let definition: TaskDefinition
    public let occurrence: TaskOccurrence
    public let assignment: TaskAssignment?
    public var assignee: User? = nil
    public var suggestedAssignee: User? = nil

    public init(
        definition: TaskDefinition,
        occurrence: TaskOccurrence,
        assignment: TaskAssignment?,
        assignee: User? = nil,
        suggestedAssignee: User? = nil
    ) {
        self.definition = definition
        self.occurrence = occurrence
        self.assignment = assignment
        self.assignee = assignee
        self.suggestedAssignee = suggestedAssignee
    }

    public var id: TaskOccurrence.ID { occurrence.id }
}

// Undated tasks follow dated tasks; ties remain stable across reloads.
extension Array where Element == TaskItem {
    public func sortedByDeadline() -> [TaskItem] {
        sorted {
            let left = $0.occurrence.dueAt ?? .distantFuture
            let right = $1.occurrence.dueAt ?? .distantFuture
            if left != right { return left < right }
            if $0.definition.name != $1.definition.name { return $0.definition.name < $1.definition.name }
            return $0.id.uuidString < $1.id.uuidString
        }
    }
}
