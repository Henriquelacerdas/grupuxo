//
//  GetTaskDefinitionUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Foundation

struct GetTaskDefinitionUseCase: Sendable {

    let repository: any TaskRepository

    func callAsFunction(
        id: TaskDefinition.ID,
        requesting userID: User.ID
    ) async throws -> TaskDefinition {

        try await repository.taskDefinition(
            id: id,
            requesting: userID
        )

    }

}
