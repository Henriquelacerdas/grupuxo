struct GetHouseRoomsUseCase: Sendable {
    let repository: any RoomRepository

    func callAsFunction(houseID: House.ID) async throws -> [Room] {
        try await repository.rooms(in: houseID)
    }
}
