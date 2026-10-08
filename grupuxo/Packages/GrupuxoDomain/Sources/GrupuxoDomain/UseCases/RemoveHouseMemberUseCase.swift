import Foundation

public struct RemoveHouseMemberUseCase: Sendable {
    public let repository: any HouseRepository

    public init(repository: any HouseRepository) {
        self.repository = repository
    }

    public func callAsFunction(userID: User.ID, houseID: House.ID, requestedBy: User.ID, date: Date = .now, confirmRoomDeletion: Bool = false) async throws {
        guard userID != requestedBy else { throw DomainError.cannotRemoveCurrentUser }
        try await repository.removeMember(userID: userID, from: houseID, requestedBy: requestedBy, at: date, confirmRoomDeletion: confirmRoomDeletion)
    }
}
