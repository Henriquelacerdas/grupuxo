import Foundation

struct HouseMembership: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let houseID: House.ID
    let userID: User.ID
}
