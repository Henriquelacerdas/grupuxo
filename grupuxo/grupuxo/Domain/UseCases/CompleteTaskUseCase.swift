import Foundation

struct CompleteTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID, date: Date = .now) async throws {
        try await repository.complete(occurrenceID: occurrenceID, by: userID, at: date)
    }
}
