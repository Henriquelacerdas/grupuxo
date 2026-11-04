//
//  MyTasksIntent.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 03/11/26.
//

import AppIntents

struct OpenMyTasksIntent: AppIntent {

    static let title: LocalizedStringResource = "Abrir Minhas Tarefas"

    static let description = IntentDescription(
        "Abre a tela de Minhas Tarefas do Grupuxo."
    )

    static let openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutNavigationManager.shared.navigate(to: .myTasks)

        return .result()
    }
}
