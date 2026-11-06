import Foundation

/// Como o cômodo foi cuidado no ciclo: três níveis, sem estrelas nem texto livre (docs/DESIGN.md).
public enum RatingLevel: String, CaseIterable, Codable, Sendable {
    case needsWork
    case good
    case great
}

/// Tags opcionais e genéricas da avaliação (catálogo fixo; o servidor recusa o resto).
public enum RatingTag: String, CaseIterable, Codable, Sendable {
    case wellDone
    case onTime
    case tidy
    case wentTheExtraMile
    case rushed
    case late
    case missedSpots
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
