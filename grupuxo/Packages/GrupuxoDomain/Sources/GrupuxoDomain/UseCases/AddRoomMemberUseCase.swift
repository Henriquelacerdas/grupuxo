import Foundation

public struct AddRoomMemberUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(userID: User.ID, roomID: Room.ID, date: Date = .now) async throws {
        try await repository.addMember(userID: userID, to: roomID, at: date)
    }
}
