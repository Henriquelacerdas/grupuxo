import Foundation

public struct ClaimSporadicTaskUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(occurrenceID: TaskOccurrence.ID, userID: User.ID, date: Date = .now) async throws {
        try await repository.claim(occurrenceID: occurrenceID, by: userID, at: date)
    }
}
