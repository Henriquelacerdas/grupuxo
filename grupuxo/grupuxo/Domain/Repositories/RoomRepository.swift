import Foundation

protocol RoomRepository: Sendable {
    func participation(in roomID: Room.ID, requesting userID: User.ID, at date: Date) async throws -> RoomParticipation

    func room(
        id: Room.ID,
        requesting userID: User.ID
    ) async throws -> Room

    func rooms(
        in houseID: House.ID,
        requesting userID: User.ID
    ) async throws -> [Room]

    func create(
        _ room: Room,
        memberships: [RoomMembership]
    ) async throws -> Room
}
