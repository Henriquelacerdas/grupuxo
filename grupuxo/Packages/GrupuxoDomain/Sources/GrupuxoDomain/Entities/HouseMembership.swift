import Foundation

public struct HouseMembership: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let houseID: House.ID
    public let userID: User.ID

    public init(
        id: UUID,
        houseID: House.ID,
        userID: User.ID
    ) {
        self.id = id
        self.houseID = houseID
        self.userID = userID
    }
}
