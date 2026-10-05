import Foundation

public struct Room: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let houseID: House.ID
    public var name: String
    public var kind: RoomKind
    public var category: RoomCategory = .other
    public var visibility: RoomVisibility
    public var periodicity = WeeklyPeriodicity()
    public var responsibleCount = 1
    public var calendarAnchor: Date? = nil
    public var scheduleVersions: [RoomScheduleVersion] = []
    public var icon = "house.fill"
    public var color: RoomColor = .blue

    public nonisolated var representsWholeHouse: Bool { kind == .wholeHouse }

    private enum CodingKeys: String, CodingKey {
        case id, houseID, name, kind, category, visibility, periodicity, responsibleCount
        case calendarAnchor, scheduleVersions, icon, color, appearance
    }

    public init(
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

    public init(from decoder: Decoder) throws {
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

    public func encode(to encoder: Encoder) throws {
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

public struct RoomScheduleVersion: Hashable, Codable, Sendable {
    public var effectiveAt: Date
    public var queue: [User.ID]
    public var responsibleCount: Int
    public var taskRoles: [TaskDefinition.ID: Int]
    public var periodIndex: Int

    public init(
        effectiveAt: Date,
        queue: [User.ID],
        responsibleCount: Int,
        taskRoles: [TaskDefinition.ID: Int],
        periodIndex: Int
    ) {
        self.effectiveAt = effectiveAt
        self.queue = queue
        self.responsibleCount = responsibleCount
        self.taskRoles = taskRoles
        self.periodIndex = periodIndex
    }
}

public struct RoomParticipation: Equatable, Sendable {
    public let room: Room
    public let isMember: Bool
    public let memberCount: Int
    public let responsibleNames: [String]
    public let periodStart: Date
    public let periodEnd: Date

    public init(
        room: Room,
        isMember: Bool,
        memberCount: Int,
        responsibleNames: [String],
        periodStart: Date,
        periodEnd: Date
    ) {
        self.room = room
        self.isMember = isMember
        self.memberCount = memberCount
        self.responsibleNames = responsibleNames
        self.periodStart = periodStart
        self.periodEnd = periodEnd
    }
}
