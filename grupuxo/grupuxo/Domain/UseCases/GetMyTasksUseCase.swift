struct GetMyTasksUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(userID: User.ID, houseID: House.ID) async throws -> [TaskItem] {
        try await repository.tasks(for: userID, in: houseID).sortedByDeadline()
    }
}
