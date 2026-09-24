struct TaskEligibilityPolicy: Sendable {
    nonisolated func canView(
        _ definition: TaskDefinition,
        room: Room,
        userID: User.ID,
        roomMemberships: [RoomMembership]
    ) -> Bool {
        let canAccessRoom = roomMemberships.contains { $0.roomID == room.id && $0.userID == userID && $0.isCurrent }
        return canAccessRoom
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
