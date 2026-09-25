import Foundation

struct CompleteTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID, date: Date = .now, isCompleted: Bool = true) async throws {
        if isCompleted {
            try await repository.complete(occurrenceID: occurrenceID, by: userID, at: date)
        } else {
            try await repository.reopen(occurrenceID: occurrenceID, by: userID)
        }
    }
}
