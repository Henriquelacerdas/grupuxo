//
//  NewTaskIntent.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 04/11/26.
//

import AppIntents
import GrupuxoDomain

struct CreateTaskIntent: AppIntent {

    static let title: LocalizedStringResource =
        "Criar Tarefa"

    static let description = IntentDescription(
        "Cria uma tarefa no Reveza."
    )

    static let openAppWhenRun: Bool = true

    @Parameter(title: "Nome da tarefa")
    var taskName: String

    @Parameter(title: "Período")
    var period: ShortcutTaskPeriod

    @Parameter(
        title: "Cômodo",
        description: "Nome do cômodo. Se vazio, usa Casa toda."
    )
    var roomName: String?

    @Parameter(title: "Confirmar antes de salvar", default: false)
    var reviewBeforeSaving: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Criar \(\.$taskName) \(\.$period)") {
            \.$roomName
            \.$reviewBeforeSaving
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult {

        var draft = TaskDraft()

        draft.name = taskName
        draft.kind = .recurring
        draft.recurrence = period.recurrence
        draft.assignmentPolicy = .balancedAutomatically

        ShortcutNavigationManager.shared.openTaskCreation(
            ShortcutTaskRequest(
                draft: draft,
                roomName: roomName,
                saveAutomatically: !reviewBeforeSaving
            )
        )

        return .result()
    }
}
