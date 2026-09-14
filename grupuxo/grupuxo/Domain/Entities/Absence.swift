import Foundation

struct Absence: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let membershipID: HouseMembership.ID
    let startsAt: Date
    let endsAt: Date
    var reason: String?

    init(id: UUID, membershipID: HouseMembership.ID, startsAt: Date, endsAt: Date, reason: String? = nil) throws {
        guard startsAt <= endsAt else { throw DomainError.invalidDateInterval }
        self.id = id
        self.membershipID = membershipID
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.reason = reason
    }
}
