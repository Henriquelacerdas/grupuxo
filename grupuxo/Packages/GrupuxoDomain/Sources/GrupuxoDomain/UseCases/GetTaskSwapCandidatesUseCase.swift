//
//  GetTaskSwapCandidatesUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public struct GetTaskSwapCandidatesUseCase: Sendable {

    public let repository: any TaskSwapRepository

    public init(repository: any TaskSwapRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        requesterID: User.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        houseID: House.ID,
        date: Date = .now
    ) async throws -> [TaskItem] {

        try await repository.swapCandidates(
            for: requesterID,
            offering: offeredOccurrenceID,
            in: houseID,
            at: date
        )
    }
}
