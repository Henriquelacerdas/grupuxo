import Foundation

struct TaskAssignment: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let occurrenceID: TaskOccurrence.ID
    let userID: User.ID
    let assignedAt: Date
    var endedAt: Date?

    nonisolated var isActive: Bool { endedAt == nil }
}
