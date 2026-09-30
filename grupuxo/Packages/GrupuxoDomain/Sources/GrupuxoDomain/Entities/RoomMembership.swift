import Foundation

public struct RoomMembership: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let roomID: Room.ID
    public let userID: User.ID

    // Saldo de Justiça (Fairness Debt) para o balanceamento matemático.
    // Positivo: Trabalhou mais que a média. Negativo: Trabalhou menos.
    public var fairnessDebt: Double = 0.0
    // Access changes immediately; rotation changes at the next Monday.
    public var leftAt: Date? = nil
    public var rotationChanges: [RotationParticipationChange]? = nil

    public init(
        id: UUID,
        roomID: Room.ID,
        userID: User.ID,
        fairnessDebt: Double = 0.0,
        leftAt: Date? = nil,
        rotationChanges: [RotationParticipationChange]? = nil
    ) {
        self.id = id
        self.roomID = roomID
        self.userID = userID
        self.fairnessDebt = fairnessDebt
        self.leftAt = leftAt
        self.rotationChanges = rotationChanges
    }

    public nonisolated var isCurrent: Bool { leftAt == nil }

    public nonisolated func participates(at date: Date) -> Bool {
        rotationChanges?.filter { $0.effectiveAt <= date }
            .max { $0.effectiveAt < $1.effectiveAt }?.participates ?? true
    }
}

public struct RotationParticipationChange: Hashable, Codable, Sendable {
    public let effectiveAt: Date
    public let participates: Bool

    public init(effectiveAt: Date, participates: Bool) {
        self.effectiveAt = effectiveAt
        self.participates = participates
    }
}
