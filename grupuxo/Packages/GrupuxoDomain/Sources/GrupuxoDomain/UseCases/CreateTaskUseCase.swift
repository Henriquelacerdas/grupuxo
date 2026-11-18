import Foundation

public struct CreateTaskUseCase: Sendable {
    public let repository: any TaskRepository
    public let roomRepository: any RoomRepository

    public init(repository: any TaskRepository, roomRepository: any RoomRepository) {
        self.repository = repository
        self.roomRepository = roomRepository
    }

    public func callAsFunction(definition: TaskDefinition, requestedBy userID: User.ID, date: Date = .now) async throws -> TaskDefinition {
        guard !definition.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        guard definition.recurrence.hasValidInterval else {
            throw DomainError.invalidSchedule
        }
        switch definition.kind {
        case .sporadic:
            guard definition.recurrence == .none,
                  definition.assignmentPolicy == .selfAssigned else {
                throw DomainError.invalidSchedule
            }
        case .recurring:
            guard definition.assignmentPolicy != .selfAssigned,
                  definition.assignmentPolicy == .afterCompletion || definition.recurrence.isRepeating else {
                throw DomainError.invalidSchedule
            }
        }
        // Repository commits the domain plan against the same snapshot used for optimization.
        let created = try await repository.create(definition, requestedBy: userID, at: date)
        if created.kind == .sporadic { await assignToCreator(created, userID: userID, date: date) }
        return created
    }

    /// "Será adicionada para você": a tarefa única nasce sem responsável no servidor; quem a criou a assume.
    /// Se isso falhar, a tarefa já existe e continua podendo ser assumida na lista de tarefas únicas.
    private func assignToCreator(_ definition: TaskDefinition, userID: User.ID, date: Date) async {
        guard let items = try? await repository.occurrences(of: definition.id, requesting: userID),
              let open = items.first(where: { !$0.occurrence.isCompleted && $0.assignment == nil })
        else { return }
        try? await repository.claim(occurrenceID: open.occurrence.id, by: userID, at: date)
    }
}
