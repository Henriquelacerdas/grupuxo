struct ReleaseSporadicTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID) async throws {
        try await repository.release(occurrenceID: occurrenceID, by: userID)
    }
}
