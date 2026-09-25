//
//  GetTaskSwapCandidatesUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct GetTaskSwapCandidatesUseCase: Sendable {

    let repository: any TaskSwapRepository

    func callAsFunction(
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
