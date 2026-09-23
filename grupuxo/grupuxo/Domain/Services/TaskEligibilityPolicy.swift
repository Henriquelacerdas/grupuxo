// GUIA — Acesso ao cômodo privado e visibilidade da tarefa são duas verificações.
// TODO: reutilizar essa política em consultas e ações, incluindo criação, com
// validação adicional de participação na casa. canView não basta para distribuir:
// montar candidatos com participação no cômodo e excluir férias. Nunca permitir
// que a distribuição atribua tarefa privada a quem não pode vê-la.

struct TaskEligibilityPolicy: Sendable {
    nonisolated func canView(
        _ definition: TaskDefinition,
        room: Room,
        userID: User.ID,
        roomMemberships: [RoomMembership]
    ) -> Bool {
        let canAccessRoom = room.visibility == .common
            || roomMemberships.contains { $0.roomID == room.id && $0.userID == userID && $0.isCurrent }
        let canAccessTask = definition.visibility == .house || definition.ownerUserID == userID
        return canAccessRoom && canAccessTask
    }

    nonisolated func canClaim(
        _ item: TaskItem,
        room: Room,
        userID: User.ID,
        roomMemberships: [RoomMembership]
    ) -> Bool {
        let hasNoAssignment = item.assignment.map { _ in false } ?? true
        return item.definition.kind == .sporadic
            && !item.occurrence.isCompleted
            && hasNoAssignment
            && canView(item.definition, room: room, userID: userID, roomMemberships: roomMemberships)
    }
}
