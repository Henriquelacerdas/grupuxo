public struct GetSporadicTasksUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [TaskItem] {
        try await repository.sporadicTasks(in: houseID, requesting: userID).sortedByDeadline()
    }
}
