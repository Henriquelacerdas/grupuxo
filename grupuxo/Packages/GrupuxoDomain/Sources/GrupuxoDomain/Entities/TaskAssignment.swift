import Foundation

public struct TaskAssignment: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let occurrenceID: TaskOccurrence.ID
    public let userID: User.ID
    public let assignedAt: Date
    public var endedAt: Date?

    // Cancels a published future plan without inventing a negative execution interval.
    public var supersededAt: Date? = nil

    public init(
        id: UUID,
        occurrenceID: TaskOccurrence.ID,
        userID: User.ID,
        assignedAt: Date,
        endedAt: Date?,
        supersededAt: Date? = nil
    ) {
        self.id = id
        self.occurrenceID = occurrenceID
        self.userID = userID
        self.assignedAt = assignedAt
        self.endedAt = endedAt
        self.supersededAt = supersededAt
    }
    public nonisolated var isActive: Bool { endedAt == nil && supersededAt == nil }
}
