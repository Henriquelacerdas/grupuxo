// GUIA — Cadastro da configuração, não de cada execução da tarefa.
// Toda tarefa, inclusive avulsa, tem roomID. Recorrência define quando gerar
// ocorrências; assignmentPolicy define como escolher o responsável.
// Na entrega atual, avulsa corresponde a .sporadic, recurrence = .none e
// assignmentPolicy = .selfAssigned. Uma tarefa privada e um cômodo privado são
// restrições diferentes; preservar ambas nas consultas.
// Alterar esforço na definição não deve reescrever snapshots de ocorrências passadas.

import Foundation

struct TaskDefinition: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var roomID: Room.ID
    var name: String
    var details: String
    var effort: TaskEffort
    var kind: TaskKind
    var visibility: TaskVisibility
    var recurrence: RecurrencePolicy
    var assignmentPolicy: TaskAssignmentPolicy
    var ownerUserID: User.ID?

    // Fila estática; cursor da próxima ocorrência ainda não publicada.
    var rotationQueue: [User.ID] = []
    var currentRotationIndex: Int = 0
    var nextScheduledAt: Date? = nil
    var pendingRotation: PendingRotation? = nil
}

struct PendingRotation: Hashable, Codable, Sendable {
    let effectiveAt: Date
    let queue: [User.ID]
}
