struct GetHouseMembersUseCase: Sendable {
    let repository: any HouseRepository

    func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [User] {
        guard try await repository.memberIDs(in: houseID).contains(userID) else {
            throw DomainError.taskUnavailable
        }
        return try await repository.members(in: houseID)
    }
}
