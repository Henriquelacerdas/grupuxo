import Foundation

/// Pedido de um morador para entrar em um cômodo privado de que não participa.
/// Quem participa do cômodo aprova ou recusa; quem pediu pode cancelar.
public struct RoomAccessRequest: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let roomID: Room.ID
    public let userID: User.ID
    public let requestedAt: Date

    public init(id: UUID, roomID: Room.ID, userID: User.ID, requestedAt: Date) {
        self.id = id
        self.roomID = roomID
        self.userID = userID
        self.requestedAt = requestedAt
    }
}
