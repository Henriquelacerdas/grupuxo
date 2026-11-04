//
//  Shortcuts.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 03/11/26.
//

import AppIntents

struct GrupuxoShortcuts: AppShortcutsProvider {

    static var appShortcuts: [AppShortcut] {

        AppShortcut(
            intent: OpenMyTasksIntent(),
            phrases: [
                "Abrir minhas tarefas no \(.applicationName)",
                "Minhas tarefas no \(.applicationName)"
            ],
            shortTitle: "Minhas Tarefas",
            systemImageName: "checkmark.circle"
        )

        AppShortcut(
            intent: OpenSporadicTasksIntent(),
            phrases: [
                "Abrir tarefas avulsas no \(.applicationName)",
                "Minhas tarefas avulsas no \(.applicationName)"
            ],
            shortTitle: "Tarefas Avulsas",
            systemImageName: "flag"
        )
    }
}
