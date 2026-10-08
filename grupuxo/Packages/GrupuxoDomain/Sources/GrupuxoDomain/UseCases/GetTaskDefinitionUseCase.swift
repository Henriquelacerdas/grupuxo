//
//  GetTaskDefinitionUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Foundation

public struct GetTaskDefinitionUseCase: Sendable {

    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        id: TaskDefinition.ID,
        requesting userID: User.ID
    ) async throws -> TaskDefinition {

        try await repository.taskDefinition(
            id: id,
            requesting: userID
        )
    }
}
