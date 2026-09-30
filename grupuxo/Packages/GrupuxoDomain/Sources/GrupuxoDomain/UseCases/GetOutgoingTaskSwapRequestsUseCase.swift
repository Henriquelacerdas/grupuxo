//
//  GetOutgoingTaskSwapRequestsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

public struct GetOutgoingTaskSwapRequestsUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        userID: User.ID,
        houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        try await repository.outgoingRequests(
            for: userID,
            in: houseID
        )
    }
}
