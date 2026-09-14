import Foundation

struct RoomMembership: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let roomID: Room.ID
    let userID: User.ID
}
