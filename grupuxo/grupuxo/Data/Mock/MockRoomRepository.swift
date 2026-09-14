struct MockRoomRepository: RoomRepository {
    let store: MockStore

    func room(id: Room.ID) async throws -> Room {
        try await store.read { state in
            guard let room = state.rooms.first(where: { $0.id == id }) else { throw DomainError.entityNotFound }
            return room
        }
    }

    func rooms(in houseID: House.ID) async throws -> [Room] {
        await store.read { state in state.rooms.filter { $0.houseID == houseID } }
    }
}
