public struct GetRoomTasksUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(roomID: Room.ID, userID: User.ID) async throws -> [TaskItem] {
        try await repository.tasks(in: roomID, requesting: userID).sortedByDeadline()
    }
}
