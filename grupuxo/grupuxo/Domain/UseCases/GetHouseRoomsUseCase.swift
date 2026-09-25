import Foundation

struct GetHouseRoomsUseCase: Sendable {
    let repository: any RoomRepository
    func callAsFunction(houseID: House.ID, userID: User.ID, participatingOnly: Bool = false) async throws -> [Room] {
        let rooms = try await repository.rooms(in: houseID, requesting: userID)
        guard participatingOnly else { return rooms }
        var result: [Room] = []
        for room in rooms {
            if try await repository.participation(in: room.id, requesting: userID, at: .now).isMember { result.append(room) }
        }
        return result
    }
}

struct GetRoomParticipationUseCase: Sendable {
    let repository: any RoomRepository
    func callAsFunction(roomID: Room.ID, userID: User.ID) async throws -> RoomParticipation {
        try await repository.participation(in: roomID, requesting: userID, at: .now)
    }
}
