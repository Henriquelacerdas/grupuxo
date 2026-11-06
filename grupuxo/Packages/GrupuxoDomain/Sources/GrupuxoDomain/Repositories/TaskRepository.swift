import Foundation

public protocol TaskRepository: Sendable {

    func tasks(
        for userID: User.ID,
        in houseID: House.ID
    ) async throws -> [TaskItem]

    func tasks(
        in roomID: Room.ID,
        requesting userID: User.ID
    ) async throws -> [TaskItem]

    /// Every scheduled occurrence of one definition (past, current and future).
    func occurrences(
        of taskDefinitionID: TaskDefinition.ID,
        requesting userID: User.ID
    ) async throws -> [TaskItem]

    func sporadicTasks(
        in houseID: House.ID,
        requesting userID: User.ID
    ) async throws -> [TaskItem]

    func taskDefinition(
        id: TaskDefinition.ID,
        requesting userID: User.ID
    ) async throws -> TaskDefinition

    /// Edita a tarefa: nome e descrição sempre; `effort` e `recurrence` quando mudam. Só a tarefa de repetição própria
    /// muda o intervalo (`recurrence`); a avulsa é de quem criou e a recorrente, de quem participa do cômodo.
    func updateTaskDetails(
        id: TaskDefinition.ID,
        name: String,
        details: String,
        effort: TaskEffort?,
        recurrence: RecurrencePolicy?,
        requestedBy userID: User.ID
    ) async throws -> TaskDefinition

    /// Encerra a tarefa recorrente: o histórico fica, as ocorrências futuras somem e as trocas
    /// pendentes que as citavam são recusadas.
    func endTask(
        _ taskID: TaskDefinition.ID,
        requestedBy userID: User.ID,
        at date: Date
    ) async throws

    func deleteSporadicTask(
        id: TaskDefinition.ID,
        requestedBy userID: User.ID
    ) async throws

    func create(
        _ definition: TaskDefinition,
        requestedBy userID: User.ID,
        at date: Date
    ) async throws -> TaskDefinition

    func refreshSchedule(
        in houseID: House.ID,
        at date: Date
    ) async throws

    func addMember(
        userID: User.ID,
        to roomID: Room.ID,
        at date: Date
    ) async throws

    func removeMember(
        userID: User.ID,
        from roomID: Room.ID,
        at date: Date,
        confirmDeletion: Bool
    ) async throws

    func complete(
        occurrenceID: TaskOccurrence.ID,
        by userID: User.ID,
        at date: Date
    ) async throws

    func reopen(
        occurrenceID: TaskOccurrence.ID,
        by userID: User.ID
    ) async throws

    func claim(
        occurrenceID: TaskOccurrence.ID,
        by userID: User.ID,
        at date: Date
    ) async throws

    func release(
        occurrenceID: TaskOccurrence.ID,
        by userID: User.ID
    ) async throws
}

extension TaskRepository {

    /// Só nome e descrição (o esforço e a repetição não mudam).
    public func updateTaskDetails(
        id: TaskDefinition.ID,
        name: String,
        details: String,
        requestedBy userID: User.ID
    ) async throws -> TaskDefinition {
        try await updateTaskDetails(
            id: id, name: name, details: details, effort: nil, recurrence: nil, requestedBy: userID
        )
    }
}
