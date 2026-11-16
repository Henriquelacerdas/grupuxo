import Foundation

/// Como o cômodo foi cuidado no ciclo: três níveis, sem estrelas nem texto livre (docs/DESIGN.md).
public enum RatingLevel: String, CaseIterable, Codable, Sendable {
    case needsWork
    case good
    case great
}

/// Tags opcionais e genéricas da avaliação (catálogo fixo; o servidor recusa o resto). As quatro primeiras dizem o que
/// foi bom (níveis bom e ótimo); as outras quatro, o que pode melhorar (nível "precisa melhorar").
public enum RatingTag: String, CaseIterable, Codable, Sendable {
    case spotless
    case tidy
    case onTime
    case careful
    case notCleaned
    case messy
    case halfDone
    case tookTooLong

    /// Tag de "o que pode melhorar".
    public var isImprovement: Bool {
        switch self {
        case .notCleaned, .messy, .halfDone, .tookTooLong: true
        case .spotless, .tidy, .onTime, .careful: false
        }
    }

    /// As tags que o nível aceita: melhorar para "precisa melhorar", elogio para os demais.
    public static func options(for level: RatingLevel) -> [RatingTag] {
        allCases.filter { $0.isImprovement == (level == .needsWork) }
    }
}

/// Um cômodo cujo ciclo acabou e que o morador pode avaliar até `windowEnd` ("Termina terça").
public struct PendingRating: Identifiable, Hashable, Sendable {
    public let roomID: Room.ID
    public let roomName: String
    public let periodStart: Date
    public let periodEnd: Date
    public let windowEnd: Date

    public var id: Room.ID { roomID }

    public init(roomID: Room.ID, roomName: String, periodStart: Date, periodEnd: Date, windowEnd: Date) {
        self.roomID = roomID
        self.roomName = roomName
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.windowEnd = windowEnd
    }
}

/// O que o morador escolheu para um cômodo.
public struct RoomRatingChoice: Hashable, Sendable {
    public let roomID: Room.ID
    public let periodStart: Date
    public let level: RatingLevel
    public let tags: [RatingTag]

    public init(roomID: Room.ID, periodStart: Date, level: RatingLevel, tags: [RatingTag]) {
        self.roomID = roomID
        self.periodStart = periodStart
        self.level = level
        self.tags = tags
    }
}

/// Um cômodo no Resumo da semana. `level` é `nil` quando ninguém avaliou (a janela fechou sem avaliações). As tags só
/// vêm nos cômodos de que o morador cuidou; nos demais ficam vazias. Nunca traz quem avaliou.
public struct RoomWeekResult: Identifiable, Hashable, Sendable {
    public let roomID: Room.ID
    public let roomName: String
    public let periodStart: Date
    public let periodEnd: Date
    public let ratingCount: Int
    public let level: RatingLevel?
    public let tags: [RatingTag]
    public let responsibleUserIDs: [User.ID]
    public let responsibleNames: [String]

    public var id: Room.ID { roomID }

    public init(
        roomID: Room.ID, roomName: String, periodStart: Date, periodEnd: Date, ratingCount: Int, level: RatingLevel?,
        tags: [RatingTag], responsibleUserIDs: [User.ID], responsibleNames: [String]
    ) {
        self.roomID = roomID
        self.roomName = roomName
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.ratingCount = ratingCount
        self.level = level
        self.tags = tags
        self.responsibleUserIDs = responsibleUserIDs
        self.responsibleNames = responsibleNames
    }
}

/// Resumo da semana (Figma): o período, as tarefas feitas na casa, os cômodos de que o morador cuidou ("Seu cômodo"),
/// os demais ("Casa") e os que ainda não terminaram o primeiro ciclo.
public struct WeekSummary: Hashable, Sendable {
    public let weekStart: Date
    public let weekEnd: Date
    public let tasksDone: Int
    public let tasksTotal: Int
    public let mine: [RoomWeekResult]
    public let house: [RoomWeekResult]
    public let upcomingRoomNames: [String]

    public init(
        weekStart: Date, weekEnd: Date, tasksDone: Int, tasksTotal: Int, mine: [RoomWeekResult], house: [RoomWeekResult],
        upcomingRoomNames: [String]
    ) {
        self.weekStart = weekStart
        self.weekEnd = weekEnd
        self.tasksDone = tasksDone
        self.tasksTotal = tasksTotal
        self.mine = mine
        self.house = house
        self.upcomingRoomNames = upcomingRoomNames
    }

    /// Há resultado de cômodo que o morador cuidou para mostrar (a linha "Resumo da semana" em Minhas tarefas).
    public var hasResultForMyRooms: Bool { mine.contains { $0.level != nil } }

    public static let empty = WeekSummary(
        weekStart: .distantPast, weekEnd: .distantPast, tasksDone: 0, tasksTotal: 0, mine: [], house: [], upcomingRoomNames: []
    )
}
