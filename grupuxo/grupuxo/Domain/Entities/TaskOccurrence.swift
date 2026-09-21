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
    var assignee: User? = nil

    var id: TaskOccurrence.ID { occurrence.id }
}

// Undated tasks follow dated tasks; ties remain stable across reloads.
extension Array where Element == TaskItem {
    func sortedByDeadline() -> [TaskItem] {
        sorted {
            let left = $0.occurrence.dueAt ?? .distantFuture
            let right = $1.occurrence.dueAt ?? .distantFuture
            if left != right { return left < right }
            if $0.definition.name != $1.definition.name { return $0.definition.name < $1.definition.name }
            return $0.id.uuidString < $1.id.uuidString
        }
    }
}
