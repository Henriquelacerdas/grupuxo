import Foundation

struct RoomAccessRequest: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let roomID: Room.ID
    let requesterID: User.ID
    var status: RoomAccessRequestStatus
    let requestedAt: Date
    var resolvedAt: Date?
}
