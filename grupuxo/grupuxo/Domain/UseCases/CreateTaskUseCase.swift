import Foundation

struct CreateTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(definition: TaskDefinition, date: Date = .now) async throws -> TaskDefinition {
        guard !definition.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        guard definition.recurrence.hasValidInterval else {
            throw DomainError.invalidSchedule
        }
        switch definition.kind {
        case .sporadic:
            guard definition.recurrence == .none,
                  definition.assignmentPolicy == .selfAssigned else {
                throw DomainError.invalidSchedule
            }
        case .recurring:
            guard definition.assignmentPolicy != .selfAssigned,
                  definition.assignmentPolicy == .afterCompletion || definition.recurrence.isRepeating else {
                throw DomainError.invalidSchedule
            }
        }
        // Repository commits the domain plan against the same snapshot used for optimization.
        return try await repository.create(definition, at: date)
    }
}
