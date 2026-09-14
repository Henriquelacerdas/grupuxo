import Foundation

struct TaskOccurrence: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let taskDefinitionID: TaskDefinition.ID
    var availableAt: Date
    var dueAt: Date?
    var status: TaskOccurrenceStatus
    var completedAt: Date?
    var completedByUserID: User.ID?
    let effortSnapshot: TaskEffort

    nonisolated var isCompleted: Bool { status == .completed }
}

struct TaskItem: Identifiable, Hashable, Sendable {
    let definition: TaskDefinition
    let occurrence: TaskOccurrence
    let assignment: TaskAssignment?

    var id: TaskOccurrence.ID { occurrence.id }
}
