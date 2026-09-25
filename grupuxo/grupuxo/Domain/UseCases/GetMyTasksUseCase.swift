struct GetMyTasksUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(userID: User.ID, houseID: House.ID) async throws -> [TaskItem] {
        let tasks = try await repository.tasks(for: userID, in: houseID).sortedByDeadline()
        return tasks.filter { !$0.occurrence.isCompleted } + tasks.filter { $0.occurrence.isCompleted }
    }
}
