import Foundation

struct TaskDefinition: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var roomID: Room.ID
    var name: String
    var details: String
    var effort: TaskEffort
    var kind: TaskKind
    var visibility: TaskVisibility
    var recurrence: RecurrencePolicy
    var assignmentPolicy: TaskAssignmentPolicy
    var ownerUserID: User.ID?
}
