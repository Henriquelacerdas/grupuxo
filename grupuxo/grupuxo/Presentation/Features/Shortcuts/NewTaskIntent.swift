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
        "Preenche o formulário para criar uma tarefa no Grupuxo."
    )

    static let openAppWhenRun: Bool = true

    @Parameter(title: "Nome da tarefa")
    var taskName: String

    @Parameter(title: "Período")
    var period: ShortcutTaskPeriod

    static var parameterSummary: some ParameterSummary {
        Summary("Criar \(\.$taskName) \(\.$period)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {

        var draft = TaskDraft()

        draft.name = taskName
        draft.kind = .recurring
        draft.recurrence = period.recurrence
        draft.assignmentPolicy = .balancedAutomatically

        ShortcutNavigationManager.shared.openTaskCreation(
            draft: draft
        )

        return .result()
    }
}
