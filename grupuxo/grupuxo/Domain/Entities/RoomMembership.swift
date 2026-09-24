import Foundation

struct RoomMembership: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let roomID: Room.ID
    let userID: User.ID

    // Saldo de Justiça (Fairness Debt) para o balanceamento matemático.
    // Positivo: Trabalhou mais que a média. Negativo: Trabalhou menos.
    var fairnessDebt: Double = 0.0
    // Access changes immediately; rotation changes at the next Monday.
    var leftAt: Date? = nil
    var rotationChanges: [RotationParticipationChange]? = nil

    nonisolated var isCurrent: Bool { leftAt == nil }

    nonisolated func participates(at date: Date) -> Bool {
        rotationChanges?.filter { $0.effectiveAt <= date }
            .max { $0.effectiveAt < $1.effectiveAt }?.participates ?? true
    }
}

struct RotationParticipationChange: Hashable, Codable, Sendable {
    let effectiveAt: Date
    let participates: Bool
}
