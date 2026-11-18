import Foundation

public struct GetRoomTasksUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    /// One item per task definition: the occurrence the room should show right now.
    public func callAsFunction(
        roomID: Room.ID,
        userID: User.ID,
        at now: Date = .now,
        cycle: RoomCycle? = nil
    ) async throws -> [TaskItem] {
        let items = try await repository.tasks(in: roomID, requesting: userID)
        return Self.currentItems(from: items, at: now, cycle: cycle).sortedByDeadline()
    }

    /// Picks, per definition: the oldest pending occurrence already available; otherwise the
    /// latest completed one already available (stays visible until the next cycle); otherwise
    /// the nearest future one. Ties break by occurrence ID.
    /// With `cycle`, a task that follows the room schedule is picked among this cycle's occurrences
    /// first: an open one left over from a previous cycle no longer hides what the cycle asks now.
    static func currentItems(from items: [TaskItem], at now: Date, cycle: RoomCycle? = nil) -> [TaskItem] {
        Dictionary(grouping: items, by: \.definition.id).values.compactMap { fullGroup in
            var group = fullGroup
            if let cycle, let definition = group.first?.definition, definition.isLinked(to: cycle.room) {
                let inCycle = group.filter { cycle.contains($0.occurrence.availableAt) }
                if !inCycle.isEmpty { group = inCycle }
            }
            let available = group.filter { $0.occurrence.availableAt <= now }
            if let pending = available.filter({ !$0.occurrence.isCompleted }).min(by: Self.earlier) {
                return pending
            }
            if let completed = available.max(by: Self.earlier) {
                return completed
            }
            return group.min(by: Self.earlier)
        }
    }

    private static func earlier(_ left: TaskItem, _ right: TaskItem) -> Bool {
        if left.occurrence.availableAt != right.occurrence.availableAt {
            return left.occurrence.availableAt < right.occurrence.availableAt
        }
        return left.id.uuidString < right.id.uuidString
    }
}

/// The room's current cycle: which occurrences of the tasks that follow its schedule belong to it.
public struct RoomCycle: Equatable, Sendable {
    public let room: Room
    public let start: Date
    /// Exclusive.
    public let end: Date

    public init(room: Room, start: Date, end: Date) {
        self.room = room
        self.start = start
        self.end = end
    }

    public func contains(_ date: Date) -> Bool { date >= start && date < end }
}
