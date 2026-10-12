import Foundation

public struct DeleteTaskUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(taskID: TaskDefinition.ID) async throws {
        try await repository.deleteTask(taskID)
    }
}
