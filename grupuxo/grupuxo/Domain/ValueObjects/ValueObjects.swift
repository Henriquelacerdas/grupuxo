import Foundation

enum TaskKind: String, Codable, Sendable, CaseIterable {
    case recurring
    case sporadic
}

enum TaskVisibility: String, Codable, Sendable, CaseIterable {
    case house
    case privateTask
}

enum RoomKind: String, Codable, Sendable, CaseIterable {
    case wholeHouse
    case standard
}

enum RoomVisibility: String, Codable, Sendable, CaseIterable {
    case common
    case privateRoom
}

enum RoomRotationPolicy: String, Codable, Sendable, CaseIterable {
    case none
    case weeklyCalendar
}
enum RoomCategory: String, Codable, Sendable, CaseIterable {
    case kitchen
    case bathroom
    case bedroom
    case livingRoom
    case laundry
    case office
    case outdoor
    case other
}

enum TaskAssignmentPolicy: String, Codable, Sendable, CaseIterable {
    case balancedAutomatically
    case calendarRotation
    case afterCompletion
    case selfAssigned
}

enum TaskOccurrenceStatus: String, Codable, Sendable {
    case available
    case assigned
    case completed
}

enum RoomAccessRequestStatus: String, Codable, Sendable {
    case pending
    case approved
    case rejected
    case cancelled
}

enum RecurrenceFrequency: String, CaseIterable, Codable, Sendable {
    case daily
    case weekly
    case monthly
    case yearly
}

enum RecurrencePolicy: Hashable, Codable, Sendable {
    case none
    case recurring(frequency: RecurrenceFrequency, interval: Int)

    var isRepeating: Bool {
        if case .recurring = self { return true }
        return false
    }

    var hasValidInterval: Bool {
        switch self {
        case .none:
            true
        case let .recurring(_, interval):
            interval > 0
        }
    }
}

// GUIA — Esforço unitário escolhido manualmente: 1, 2 ou 3. O inicializador
// atual limita valores fora da faixa; manter essa regra consistente na edição
// e validar também dados decodificados quando houver persistência externa.
struct TaskEffort: Hashable, Codable, Sendable {
    let points: Int

    nonisolated init(points: Int) {
        self.points = min(max(points, 1), 3)
    }
}

// GUIA — Carga acumulada da semana: pode ultrapassar 3. Usar este tipo no
// balanceamento; nunca limitar a soma com TaskEffort.
struct WeeklyLoad: Hashable, Codable, Sendable {
    let points: Int

    nonisolated init(points: Int) {
        self.points = max(0, points)
    }
}

struct DateIntervalValue: Hashable, Codable, Sendable {
    let start: Date
    let end: Date

    nonisolated init(start: Date, end: Date) throws {
        guard start <= end else { throw DomainError.invalidDateInterval }
        self.start = start
        self.end = end
    }
}
