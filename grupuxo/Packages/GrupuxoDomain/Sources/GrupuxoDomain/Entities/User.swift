import Foundation

public struct User: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public var name: String
    public var email: String?

    public init(
        id: UUID,
        name: String,
        email: String?
    ) {
        self.id = id
        self.name = name
        self.email = email
    }
}
