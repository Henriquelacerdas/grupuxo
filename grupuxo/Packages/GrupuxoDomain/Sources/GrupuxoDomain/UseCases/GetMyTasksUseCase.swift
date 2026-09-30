public struct GetMyTasksUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(userID: User.ID, houseID: House.ID) async throws -> [TaskItem] {
        let tasks = try await repository.tasks(for: userID, in: houseID).sortedByDeadline()
        return tasks.filter { !$0.occurrence.isCompleted } + tasks.filter { $0.occurrence.isCompleted }
    }
}
