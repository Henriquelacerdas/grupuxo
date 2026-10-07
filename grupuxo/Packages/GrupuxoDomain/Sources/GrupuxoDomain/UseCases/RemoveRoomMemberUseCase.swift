import Foundation

public struct RemoveRoomMemberUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(userID: User.ID, roomID: Room.ID, date: Date = .now, confirmDeletion: Bool = false) async throws {
        try await repository.removeMember(userID: userID, from: roomID, at: date, confirmDeletion: confirmDeletion)
    }
}
