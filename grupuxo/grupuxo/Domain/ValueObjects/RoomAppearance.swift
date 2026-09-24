/// Stored independently of SwiftUI so room appearance travels with the domain model.
struct RoomAppearance: Hashable, Codable, Sendable {
    var icon = "house.fill"
    var color: RoomColor = .blue
}

enum RoomColor: String, CaseIterable, Codable, Sendable {
    case red, orange, yellow, green, blue, purple, brown, gray, pink
}
