import Foundation

struct User: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var name: String
    var email: String?
}
