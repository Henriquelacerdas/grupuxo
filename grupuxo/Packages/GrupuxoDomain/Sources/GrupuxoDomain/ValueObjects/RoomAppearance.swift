/// Legacy serialized representation accepted when decoding rooms created before icon and color became Room attributes.
public struct RoomAppearance: Hashable, Codable, Sendable {
    public var icon = "house.fill"
    public var color: RoomColor = .blue

    public init(icon: String = "house.fill", color: RoomColor = .blue) {
        self.icon = icon
        self.color = color
    }
}

public enum RoomColor: String, CaseIterable, Codable, Sendable {
    case red, orange, yellow, green, blue, purple, brown, gray, pink
}
