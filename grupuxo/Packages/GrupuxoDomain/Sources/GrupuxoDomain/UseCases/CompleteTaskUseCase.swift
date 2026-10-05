import Foundation

public struct CompleteTaskUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID, date: Date = .now, isCompleted: Bool = true) async throws {
        if isCompleted {
            try await repository.complete(occurrenceID: occurrenceID, by: userID, at: date)
        } else {
            try await repository.reopen(occurrenceID: occurrenceID, by: userID)
        }
    }
}
