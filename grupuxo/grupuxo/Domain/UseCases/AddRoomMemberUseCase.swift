import Foundation

struct AddRoomMemberUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(userID: User.ID, roomID: Room.ID, date: Date = .now) async throws {
        try await repository.addMember(userID: userID, to: roomID, at: date)
    }
}
