import Foundation

protocol RoomRepository: Sendable {
    func room(id: Room.ID) async throws -> Room
    func rooms(in houseID: House.ID) async throws -> [Room]
}
