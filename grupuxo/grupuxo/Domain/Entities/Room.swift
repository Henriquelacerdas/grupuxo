import Foundation

struct Room: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let houseID: House.ID
    var name: String
    var kind: RoomKind
    var category: RoomCategory = .other
    var visibility: RoomVisibility
    var periodicity = WeeklyPeriodicity()
    var responsibleCount = 1
    var calendarAnchor: Date? = nil
    var scheduleVersions: [RoomScheduleVersion] = []
    var icon = "house.fill"
    var color: RoomColor = .blue

    nonisolated var representsWholeHouse: Bool { kind == .wholeHouse }

    private enum CodingKeys: String, CodingKey {
        case id, houseID, name, kind, category, visibility, periodicity, responsibleCount
        case calendarAnchor, scheduleVersions, icon, color, appearance
    }

    init(
        id: UUID,
        houseID: House.ID,
        name: String,
        kind: RoomKind,
        category: RoomCategory = .other,
        visibility: RoomVisibility,
        periodicity: WeeklyPeriodicity = WeeklyPeriodicity(),
        responsibleCount: Int = 1,
        calendarAnchor: Date? = nil,
        scheduleVersions: [RoomScheduleVersion] = [],
        icon: String = "house.fill",
        color: RoomColor = .blue
    ) {
        self.id = id
        self.houseID = houseID
        self.name = name
        self.kind = kind
        self.category = category
        self.visibility = visibility
        self.periodicity = periodicity
        self.responsibleCount = responsibleCount
        self.calendarAnchor = calendarAnchor
        self.scheduleVersions = scheduleVersions
        self.icon = icon
        self.color = color
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        houseID = try values.decode(House.ID.self, forKey: .houseID)
        name = try values.decode(String.self, forKey: .name)
        kind = try values.decode(RoomKind.self, forKey: .kind)
        category = try values.decodeIfPresent(RoomCategory.self, forKey: .category) ?? .other
        visibility = try values.decode(RoomVisibility.self, forKey: .visibility)
        periodicity = try values.decodeIfPresent(WeeklyPeriodicity.self, forKey: .periodicity) ?? WeeklyPeriodicity()
        responsibleCount = try values.decodeIfPresent(Int.self, forKey: .responsibleCount) ?? 1
        calendarAnchor = try values.decodeIfPresent(Date.self, forKey: .calendarAnchor)
        scheduleVersions = try values.decodeIfPresent([RoomScheduleVersion].self, forKey: .scheduleVersions) ?? []
        let legacyAppearance = try values.decodeIfPresent(RoomAppearance.self, forKey: .appearance)
        icon = try values.decodeIfPresent(String.self, forKey: .icon) ?? legacyAppearance?.icon ?? "house.fill"
        color = try values.decodeIfPresent(RoomColor.self, forKey: .color) ?? legacyAppearance?.color ?? .blue
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(houseID, forKey: .houseID)
        try values.encode(name, forKey: .name)
        try values.encode(kind, forKey: .kind)
        try values.encode(category, forKey: .category)
        try values.encode(visibility, forKey: .visibility)
        try values.encode(periodicity, forKey: .periodicity)
        try values.encode(responsibleCount, forKey: .responsibleCount)
        try values.encodeIfPresent(calendarAnchor, forKey: .calendarAnchor)
        try values.encode(scheduleVersions, forKey: .scheduleVersions)
        try values.encode(icon, forKey: .icon)
        try values.encode(color, forKey: .color)
    }
}

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
