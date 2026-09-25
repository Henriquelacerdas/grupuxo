import Foundation

struct RemoveHouseMemberUseCase: Sendable {
    let repository: any HouseRepository

    func callAsFunction(userID: User.ID, houseID: House.ID, requestedBy: User.ID, date: Date = .now, confirmRoomDeletion: Bool = false) async throws {
        guard userID != requestedBy else { throw DomainError.cannotRemoveCurrentUser }
        try await repository.removeMember(userID: userID, from: houseID, requestedBy: requestedBy, at: date, confirmRoomDeletion: confirmRoomDeletion)
    }
}
