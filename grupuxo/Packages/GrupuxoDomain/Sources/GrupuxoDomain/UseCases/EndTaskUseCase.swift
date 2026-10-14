import Foundation

public struct EndTaskUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        taskID: TaskDefinition.ID,
        requestedBy userID: User.ID,
        at date: Date = .now
    ) async throws {
        try await repository.endTask(taskID, requestedBy: userID, at: date)
    }
}
