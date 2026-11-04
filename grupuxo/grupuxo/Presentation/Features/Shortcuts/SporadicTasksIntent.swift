//
//  SporadicTasksIntent.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 03/11/26.
//


import AppIntents

struct OpenSporadicTasksIntent: AppIntent {

    static let title: LocalizedStringResource = "Abrir Tarefas Avulsas"

    static let openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {

        ShortcutNavigationManager.shared.navigate(
            to: .sporadicTasks
        )

        return .result()
    }
}
