public struct GetHouseMembersUseCase: Sendable {
    public let repository: any HouseRepository

    public init(repository: any HouseRepository) {
        self.repository = repository
    }

    public func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [User] {
        guard try await repository.memberIDs(in: houseID).contains(userID) else {
            throw DomainError.taskUnavailable
        }
        return try await repository.members(in: houseID)
    }
}
