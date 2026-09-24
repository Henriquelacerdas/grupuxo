import Foundation

struct TaskAssignment: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let occurrenceID: TaskOccurrence.ID
    let userID: User.ID
    let assignedAt: Date
    var endedAt: Date?

    // Cancels a published future plan without inventing a negative execution interval.
    var supersededAt: Date? = nil
    nonisolated var isActive: Bool { endedAt == nil && supersededAt == nil }
}
