//
//  UpdateTaskDetailsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Foundation

struct UpdateTaskDetailsUseCase: Sendable {

    let repository: any TaskRepository

    func callAsFunction(
        id: TaskDefinition.ID,
        name: String,
        details: String,
        requestedBy userID: User.ID
    ) async throws -> TaskDefinition {

        let trimmedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard !trimmedName.isEmpty else {
            throw DomainError.invalidTaskName
        }

        return try await repository.updateTaskDetails(
            id: id,
            name: trimmedName,
            details: details,
            requestedBy: userID
        )

    }

}
