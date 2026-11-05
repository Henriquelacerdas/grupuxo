import AppIntents
import Foundation

/// "Quais são minhas tarefas?" — lê em voz alta as tarefas pendentes do morador.
struct ListMyTasksIntent: AppIntent {
    static let title: LocalizedStringResource = "Ver minhas tarefas"
    static let description = IntentDescription("Lista as suas tarefas pendentes.")

    @Dependency var service: SiriTaskService

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let tasks = try await service.pendingTasks()
        guard !tasks.isEmpty else {
            return .result(dialog: "Você não tem tarefas pendentes.")
        }
        let names = ListFormatter.localizedString(byJoining: tasks.map(\.name))
        if tasks.count == 1 {
            return .result(dialog: "Você tem uma tarefa pendente: \(names).")
        }
        return .result(dialog: "Você tem \(tasks.count) tarefas pendentes: \(names).")
    }
}

/// "Concluir tarefa" — marca uma tarefa como concluída, sempre depois de o morador confirmar.
struct CompleteTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Concluir tarefa"
    static let description = IntentDescription("Marca uma das suas tarefas como concluída.")

    @Parameter(title: "Tarefa", requestValueDialog: "Qual tarefa você concluiu?")
    var task: TaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Concluir \(\.$task)")
    }

    @Dependency var service: SiriTaskService

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await requestConfirmation(result: .result(dialog: "Concluir \(task.name)?"))
        try await service.complete(occurrenceID: task.id)
        return .result(dialog: "Pronto, \(task.name) está concluída.")
    }
}

struct GrupuxoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ListMyTasksIntent(),
            phrases: [
                "Quais são minhas tarefas no \(.applicationName)",
                "Minhas tarefas no \(.applicationName)",
            ],
            shortTitle: "Minhas tarefas",
            systemImageName: "checklist"
        )
        AppShortcut(
            intent: CompleteTaskIntent(),
            phrases: [
                "Concluir tarefa no \(.applicationName)",
                "Concluir \(\.$task) no \(.applicationName)",
            ],
            shortTitle: "Concluir tarefa",
            systemImageName: "checkmark.circle"
        )
    }
}
