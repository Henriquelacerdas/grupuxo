import Foundation

struct Room: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let houseID: House.ID
    var name: String
    var kind: RoomKind
    var visibility: RoomVisibility
    var rotationPolicy: RoomRotationPolicy

    nonisolated var representsWholeHouse: Bool { kind == .wholeHouse }
}
