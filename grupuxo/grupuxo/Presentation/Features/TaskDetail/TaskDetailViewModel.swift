//
//  TaskDetailViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Combine
import Foundation

@MainActor
final class TaskDetailViewModel: ObservableObject {

    @Published private(set) var state: TaskDetailState = .idle
    @Published private(set) var isSaving = false
    @Published var actionError: String?

    private let getTaskDefinition: GetTaskDefinitionUseCase
    private let updateTaskDetails: UpdateTaskDetailsUseCase

    private let taskDefinitionID: TaskDefinition.ID
    private let userID: User.ID

    init(
        getTaskDefinition: GetTaskDefinitionUseCase,
        updateTaskDetails: UpdateTaskDetailsUseCase,
        taskDefinitionID: TaskDefinition.ID,
        userID: User.ID
    ) {

        self.getTaskDefinition = getTaskDefinition
        self.updateTaskDetails = updateTaskDetails
        self.taskDefinitionID = taskDefinitionID
        self.userID = userID

    }

    func load() async {

        state = .loading

        do {

            let definition = try await getTaskDefinition(
                id: taskDefinitionID,
                requesting: userID
            )

            state = .content(definition)

        } catch {

            state = .failure(
                error.localizedDescription
            )

        }

    }

    func update(
        name: String,
        details: String
    ) async -> Bool {

        guard !isSaving else {
            return false
        }

        isSaving = true

        defer {
            isSaving = false
        }

        do {

            let updatedDefinition =
                try await updateTaskDetails(
                    id: taskDefinitionID,
                    name: name,
                    details: details,
                    requestedBy: userID
                )

            state = .content(
                updatedDefinition
            )

            actionError = nil

            return true

        } catch {

            actionError =
                error.localizedDescription

            return false

        }

    }

}
