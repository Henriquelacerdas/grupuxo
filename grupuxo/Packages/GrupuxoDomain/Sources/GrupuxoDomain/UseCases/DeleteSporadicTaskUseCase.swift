import Foundation

public struct DeleteSporadicTaskUseCase: Sendable {

    public let repository: any TaskRepository

    public init(
        repository: any TaskRepository
    ) {
        self.repository = repository
    }

    public func callAsFunction(
        taskDefinitionID: TaskDefinition.ID,
        userID: User.ID
    ) async throws {

        try await repository.deleteSporadicTask(
            id: taskDefinitionID,
            requestedBy: userID
        )
    }
}
