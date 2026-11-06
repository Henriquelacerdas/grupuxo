import Foundation

/// Exclui o cômodo com tudo o que é dele. Sem `confirmDeletion`, falha com `deletionConfirmationRequired`.
public struct DeleteRoomUseCase: Sendable {

    public let repository: any RoomRepository

    public init(repository: any RoomRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        roomID: Room.ID,
        userID: User.ID,
        confirmDeletion: Bool,
        date: Date = .now
    ) async throws {
        try await repository.delete(roomID: roomID, requestedBy: userID, at: date, confirmDeletion: confirmDeletion)
    }
}
