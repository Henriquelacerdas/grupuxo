//
//  GetOutgoingTaskSwapRequestsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

struct GetOutgoingTaskSwapRequestsUseCase: Sendable {

    let repository: any TaskSwapRepository

    func callAsFunction(
        userID: User.ID,
        houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        try await repository.outgoingRequests(
            for: userID,
            in: houseID
        )
    }
}
