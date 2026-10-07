//
//  DeleteSporadicTaskUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 06/10/26.
//

import Foundation

struct DeleteSporadicTaskUseCase: Sendable {

    let repository: any TaskRepository

    func callAsFunction(
        taskDefinitionID: TaskDefinition.ID,
        userID: User.ID
    ) async throws {

        try await repository.deleteSporadicTask(
            id: taskDefinitionID,
            requestedBy: userID
        )
    }
}
