import Foundation

public struct RequestRoomAccessUseCase: Sendable {
    public let repository: any RoomAccessRequestRepository

    public init(repository: any RoomAccessRequestRepository) {
        self.repository = repository
    }

    public func callAsFunction(roomID: Room.ID, userID: User.ID, at date: Date = .now) async throws {
        try await repository.request(roomID: roomID, requesting: userID, at: date)
    }
}

public struct CancelRoomAccessRequestUseCase: Sendable {
    public let repository: any RoomAccessRequestRepository

    public init(repository: any RoomAccessRequestRepository) {
        self.repository = repository
    }

    public func callAsFunction(roomID: Room.ID, userID: User.ID) async throws {
        try await repository.cancel(roomID: roomID, requesting: userID)
    }
}
