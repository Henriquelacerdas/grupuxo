//
//  Untitled.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct AcceptTaskSwapRequestUseCase: Sendable {

    let repository: any TaskSwapRepository

    func callAsFunction(
        requestID: TaskSwapRequest.ID,
        userID: User.ID,
        date: Date = .now
    ) async throws -> TaskSwapRequest {

        try await repository.accept(
            requestID: requestID,
            by: userID,
            at: date
        )
    }
}
