//
//  GetIncomingTaskSwapRequestsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

public struct GetIncomingTaskSwapRequestsUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        userID: User.ID,
        houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        try await repository.incomingRequests(
            for: userID,
            in: houseID
        )
    }
}
