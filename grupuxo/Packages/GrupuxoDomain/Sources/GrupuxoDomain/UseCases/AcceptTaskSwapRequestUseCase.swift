//
//  Untitled.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public struct AcceptTaskSwapRequestUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
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
