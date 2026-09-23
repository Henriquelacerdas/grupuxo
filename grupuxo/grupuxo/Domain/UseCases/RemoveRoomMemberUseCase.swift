import Foundation

struct RemoveRoomMemberUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(userID: User.ID, roomID: Room.ID, date: Date = .now) async throws {
        try await repository.removeMember(userID: userID, from: roomID, at: date)
    }
}
