//
//  GetIncomingTaskSwapRequestsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

struct GetIncomingTaskSwapRequestsUseCase: Sendable {

    let repository: any TaskSwapRepository

    func callAsFunction(
        userID: User.ID,
        houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        try await repository.incomingRequests(
            for: userID,
            in: houseID
        )
    }
}
