public struct ReleaseSporadicTaskUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID) async throws {
        try await repository.release(occurrenceID: occurrenceID, by: userID)
    }
}
