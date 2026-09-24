/// Legacy serialized representation accepted when decoding rooms created before icon and color became Room attributes.
struct RoomAppearance: Hashable, Codable, Sendable {
    var icon = "house.fill"
    var color: RoomColor = .blue
}

enum RoomColor: String, CaseIterable, Codable, Sendable {
    case red, orange, yellow, green, blue, purple, brown, gray, pink
}
