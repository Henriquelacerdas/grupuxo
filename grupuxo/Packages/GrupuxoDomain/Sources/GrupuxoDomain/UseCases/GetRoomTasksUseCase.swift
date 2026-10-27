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
        at now: Date = .now
    ) async throws -> [TaskItem] {
        let items = try await repository.tasks(in: roomID, requesting: userID)
        return Self.currentItems(from: items, at: now).sortedByDeadline()
    }

    /// Picks, per definition: the oldest pending occurrence already available; otherwise the
    /// latest completed one already available (stays visible until the next cycle); otherwise
    /// the nearest future one. Ties break by occurrence ID.
    static func currentItems(from items: [TaskItem], at now: Date) -> [TaskItem] {
        Dictionary(grouping: items, by: \.definition.id).values.compactMap { group in
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
