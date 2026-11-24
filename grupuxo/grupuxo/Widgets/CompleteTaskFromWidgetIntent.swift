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
        // O snapshot otimista já pede a recarga das linhas do widget; não há segunda recarga ao final.
        let previousSnapshot = WidgetTaskStore.shared.removeTaskOptimistically(occurrenceID: id)
        do {
            #if WIDGET_EXTENSION
            // A rede segue em sessão de segundo plano: o widget não espera o servidor para redesenhar.
            try WidgetTaskStore.shared.enqueueCompletion(occurrenceID: id, previousSnapshot: previousSnapshot)
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
        #if !WIDGET_EXTENSION
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        return .result()
    }
}

