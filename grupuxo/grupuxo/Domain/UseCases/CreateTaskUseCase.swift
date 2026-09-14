import Foundation

struct CreateTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(definition: TaskDefinition) async throws -> TaskDefinition {
        guard !definition.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        return try await repository.create(definition)
    }
}
