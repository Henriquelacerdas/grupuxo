import Foundation

struct House: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var name: String
    var accessCode: String
    let createdAt: Date
}
