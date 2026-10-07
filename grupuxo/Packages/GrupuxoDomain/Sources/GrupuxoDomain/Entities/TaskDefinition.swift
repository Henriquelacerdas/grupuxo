import Foundation

public struct TaskDefinition: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public var roomID: Room.ID
    public var name: String
    public var details: String
    public var effort: TaskEffort
    public var kind: TaskKind
    public var recurrence: RecurrencePolicy
    public var assignmentPolicy: TaskAssignmentPolicy
    public var sourceSuggestionID: String? = nil
    public var createdByUserID: User.ID? = nil
    public var rotationQueue: [User.ID] = []
    public var currentRotationIndex: Int = 0
    public var nextScheduledAt: Date? = nil
    public var pendingRotation: PendingRotation? = nil
    public var calendarAnchor: Date? = nil

    public init(
        id: UUID,
        roomID: Room.ID,
        name: String,
        details: String,
        effort: TaskEffort,
        kind: TaskKind,
        recurrence: RecurrencePolicy,
        assignmentPolicy: TaskAssignmentPolicy,
        sourceSuggestionID: String? = nil,
        createdByUserID: User.ID? = nil,
        rotationQueue: [User.ID] = [],
        currentRotationIndex: Int = 0,
        nextScheduledAt: Date? = nil,
        pendingRotation: PendingRotation? = nil,
        calendarAnchor: Date? = nil
    ) {
        self.id = id
        self.roomID = roomID
        self.name = name
        self.details = details
        self.effort = effort
        self.kind = kind
        self.recurrence = recurrence
        self.assignmentPolicy = assignmentPolicy
        self.sourceSuggestionID = sourceSuggestionID
        self.createdByUserID = createdByUserID
        self.rotationQueue = rotationQueue
        self.currentRotationIndex = currentRotationIndex
        self.nextScheduledAt = nextScheduledAt
        self.pendingRotation = pendingRotation
        self.calendarAnchor = calendarAnchor
    }
}

public struct PendingRotation: Hashable, Codable, Sendable {
    public let effectiveAt: Date
    public let queue: [User.ID]

    public init(
        effectiveAt: Date,
        queue: [User.ID]
    ) {
        self.effectiveAt = effectiveAt
        self.queue = queue
    }
}
