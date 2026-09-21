struct GetRoomTasksUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(roomID: Room.ID, userID: User.ID) async throws -> [TaskItem] {
        try await repository.tasks(in: roomID, requesting: userID).sortedByDeadline()
    }
}
