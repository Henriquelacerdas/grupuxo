import Foundation

public protocol RoomRepository: Sendable {
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

    /// "Casa toda" não se edita (`wholeHouseProtected`); cômodo privado de que não participa: `entityNotFound`.
    func update(
        roomID: Room.ID,
        patch: RoomPatch,
        requestedBy userID: User.ID,
        at date: Date
    ) async throws -> Room

    /// Exige `confirmDeletion` (`deletionConfirmationRequired`); mesmas regras de acesso de `update`.
    func delete(
        roomID: Room.ID,
        requestedBy userID: User.ID,
        at date: Date,
        confirmDeletion: Bool
    ) async throws
}
