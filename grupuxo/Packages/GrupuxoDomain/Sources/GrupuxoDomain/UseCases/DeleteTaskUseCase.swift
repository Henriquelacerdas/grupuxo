import Foundation

struct DeleteTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(taskID: TaskDefinition.ID) async throws {
        try await repository.deleteTask(taskID)
    }
}
