//
//  CreateTaskSwapRequestUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public struct CreateTaskSwapRequestUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        requesterID: User.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        requestedOccurrenceID: TaskOccurrence.ID,
        date: Date = .now
    ) async throws -> TaskSwapRequest {

        try await repository.createRequest(
            requesterID: requesterID,
            offeredOccurrenceID: offeredOccurrenceID,
            requestedOccurrenceID: requestedOccurrenceID,
            at: date
        )
    }
}
