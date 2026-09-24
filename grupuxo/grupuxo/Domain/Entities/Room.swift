import Foundation

struct Room: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let houseID: House.ID
    var name: String
    var kind: RoomKind
    var visibility: RoomVisibility
    var periodicity = WeeklyPeriodicity()
    var responsibleCount = 1
    var calendarAnchor: Date? = nil
    var scheduleVersions: [RoomScheduleVersion] = []
    var appearance: RoomAppearance? = nil

    nonisolated var representsWholeHouse: Bool { kind == .wholeHouse }
}

/// Each version preserves the phase and greedy task blocks used when it was published.
struct RoomScheduleVersion: Hashable, Codable, Sendable {
    var effectiveAt: Date
    var queue: [User.ID]
    var responsibleCount: Int
    var taskRoles: [TaskDefinition.ID: Int]
    var periodIndex: Int
}

struct RoomParticipation: Equatable, Sendable {
    let room: Room
    let isMember: Bool
    let memberCount: Int
    let responsibleNames: [String]
    let periodStart: Date
    let periodEnd: Date
}
