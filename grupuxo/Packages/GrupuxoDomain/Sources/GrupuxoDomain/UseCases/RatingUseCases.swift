import Foundation

public struct GetPendingRatingsUseCase: Sendable {
    public let repository: any RatingRepository

    public init(repository: any RatingRepository) {
        self.repository = repository
    }

    public func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [PendingRating] {
        try await repository.pending(in: houseID, for: userID)
    }
}

public struct RateRoomsUseCase: Sendable {
    public let repository: any RatingRepository

    public init(repository: any RatingRepository) {
        self.repository = repository
    }

    /// Envia cada escolha; a primeira que falhar interrompe (as já enviadas ficam).
    public func callAsFunction(_ choices: [RoomRatingChoice], userID: User.ID) async throws {
        for choice in choices {
            try await repository.rate(choice, by: userID)
        }
    }
}

public struct GetRatingSummaryUseCase: Sendable {
    public let repository: any RatingRepository

    public init(repository: any RatingRepository) {
        self.repository = repository
    }

    public func callAsFunction(houseID: House.ID, userID: User.ID) async throws -> [RatingResult] {
        try await repository.summary(in: houseID, for: userID)
    }
}
