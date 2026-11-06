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
    /// Quando a tarefa foi encerrada (`endTask`). A definição e o histórico continuam; nada novo é publicado.
    public var endedAt: Date? = nil
    /// "Repetir com o cômodo": a tarefa segue a escala e a periodicidade do cômodo. `nil` = definição antiga, sem o
    /// campo: vale o que a periodicidade dela diz (igual à do cômodo). Quando o cômodo muda de periodicidade, as
    /// tarefas que o acompanham mudam junto.
    public var followsRoom: Bool? = nil

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
        calendarAnchor: Date? = nil,
        endedAt: Date? = nil,
        followsRoom: Bool? = nil
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
        self.endedAt = endedAt
        self.followsRoom = followsRoom
    }
}

extension TaskDefinition {

    /// Uma tarefa está ligada ao cômodo quando segue a escala dele: recorrente, distribuída pelo algoritmo, do
    /// mesmo cômodo e com `followsRoom` (campo explícito). Sem o campo (definição antiga), vale a periodicidade
    /// igual à do cômodo. As demais são tarefas de repetição própria.
    public func isLinked(to room: Room) -> Bool {
        guard kind == .recurring,
              assignmentPolicy != .afterCompletion,
              assignmentPolicy != .selfAssigned,
              roomID == room.id
        else { return false }
        if let followsRoom { return followsRoom }
        return recurrence.weeklyPeriodicity == room.periodicity
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
