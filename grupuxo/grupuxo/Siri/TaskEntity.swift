import AppIntents
import Foundation

/// Tarefa pendente exposta à Siri: permite frases como "concluir lavar a louça".
struct TaskEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Tarefa"
    static let defaultQuery = TaskEntityQuery()

    let id: UUID
    let name: String
    let dueAt: Date?

    init(_ task: SiriTask) {
        id = task.occurrenceID
        name = task.name
        dueAt = task.dueAt
    }

    var displayRepresentation: DisplayRepresentation {
        guard let dueAt else { return DisplayRepresentation(title: "\(name)") }
        return DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(dueAt.formatted(date: .abbreviated, time: .omitted))"
        )
    }
}

struct TaskEntityQuery: EntityStringQuery {
    @Dependency var service: SiriTaskService

    func entities(for identifiers: [UUID]) async throws -> [TaskEntity] {
        try await service.pendingTasks(withIDs: identifiers).map(TaskEntity.init)
    }

    func entities(matching string: String) async throws -> [TaskEntity] {
        try await service.pendingTasks(matching: string).map(TaskEntity.init)
    }

    func suggestedEntities() async throws -> [TaskEntity] {
        try await service.pendingTasks().map(TaskEntity.init)
    }
}
