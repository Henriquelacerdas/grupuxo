import Foundation

struct TaskDefinition: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var roomID: Room.ID
    var name: String
    var details: String
    var effort: TaskEffort
    var kind: TaskKind
    var recurrence: RecurrencePolicy
    var assignmentPolicy: TaskAssignmentPolicy
    var sourceSuggestionID: String? = nil
    var rotationQueue: [User.ID] = []
    var currentRotationIndex: Int = 0
    var nextScheduledAt: Date? = nil
    var pendingRotation: PendingRotation? = nil
    var calendarAnchor: Date? = nil
}

struct PendingRotation: Hashable, Codable, Sendable {
    let effectiveAt: Date
    let queue: [User.ID]
}
