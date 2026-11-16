import Foundation

/// Quem pediu a troca desiste enquanto ela está pendente.
public struct CancelTaskSwapRequestUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        requestID: TaskSwapRequest.ID,
        userID: User.ID,
        date: Date = .now
    ) async throws -> TaskSwapRequest {
        try await repository.cancel(requestID: requestID, by: userID, at: date)
    }
}
