import AppIntents
import Foundation
import WidgetKit

/// Conclui uma tarefa diretamente pelo botão de check do widget, sem abrir o app.
struct CompleteTaskFromWidgetIntent: AppIntent {
    static let title: LocalizedStringResource = "Concluir tarefa pelo widget"
    static let description = IntentDescription("Marca uma tarefa pendente como concluída diretamente pelo widget.")
    static let isDiscoverable = false

    @Parameter(title: "ID da ocorrência")
    var occurrenceID: String

    init() {}

    init(occurrenceID: UUID) {
        self.occurrenceID = occurrenceID.uuidString
    }

    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: occurrenceID) else {
            return .result()
        }
        let previousSnapshot = WidgetTaskStore.shared.removeTaskOptimistically(occurrenceID: id)
        do {
            #if WIDGET_EXTENSION
            try await WidgetTaskStore.shared.completeRemotely(occurrenceID: id)
            #else
            let service = SiriTaskService.make()
            try await service.complete(occurrenceID: id)
            _ = try? await service.pendingTasks()
            #endif
        } catch {
            if let previousSnapshot {
                WidgetTaskStore.shared.restoreSnapshot(previousSnapshot)
            }
            throw error
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

