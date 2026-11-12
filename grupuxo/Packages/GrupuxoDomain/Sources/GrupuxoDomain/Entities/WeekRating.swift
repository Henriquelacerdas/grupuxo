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

/// Resultado da semana de um cômodo de que o morador cuidou: só o agregado, nunca quem avaliou.
public struct RatingResult: Identifiable, Hashable, Sendable {
    public let roomID: Room.ID
    public let roomName: String
    public let periodStart: Date
    public let periodEnd: Date
    public let level: RatingLevel
    public let tags: [RatingTag]

    public var id: Room.ID { roomID }

    public init(roomID: Room.ID, roomName: String, periodStart: Date, periodEnd: Date, level: RatingLevel, tags: [RatingTag]) {
        self.roomID = roomID
        self.roomName = roomName
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.level = level
        self.tags = tags
    }
}
