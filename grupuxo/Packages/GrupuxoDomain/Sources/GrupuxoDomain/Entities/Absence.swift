import Foundation

public struct Absence: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let membershipID: HouseMembership.ID
    public let startsAt: Date
    public let endsAt: Date
    public var reason: String?

    public init(id: UUID, membershipID: HouseMembership.ID, startsAt: Date, endsAt: Date, reason: String? = nil) throws {
        guard startsAt <= endsAt else { throw DomainError.invalidDateInterval }
        self.id = id
        self.membershipID = membershipID
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.reason = reason
    }
}
