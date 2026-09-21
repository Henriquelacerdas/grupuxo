struct GetSporadicTasksUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [TaskItem] {
        try await repository.sporadicTasks(in: houseID, requesting: userID).sortedByDeadline()
    }
}
