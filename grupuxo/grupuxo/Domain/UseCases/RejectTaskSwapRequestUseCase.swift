//
//  RejectTaskSwapRequestUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct RejectTaskSwapRequestUseCase: Sendable {

    let repository: any TaskSwapRepository

    func callAsFunction(
        requestID: TaskSwapRequest.ID,
        userID: User.ID,
        date: Date = .now
    ) async throws -> TaskSwapRequest {

        try await repository.reject(
            requestID: requestID,
            by: userID,
            at: date
        )
    }
}
