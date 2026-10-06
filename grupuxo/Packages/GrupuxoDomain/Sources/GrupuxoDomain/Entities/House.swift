import Foundation

public struct House: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public var name: String
    public var accessCode: String
    public let createdAt: Date

    public init(
        id: UUID,
        name: String,
        accessCode: String,
        createdAt: Date
    ) {
        self.id = id
        self.name = name
        self.accessCode = accessCode
        self.createdAt = createdAt
    }
}
