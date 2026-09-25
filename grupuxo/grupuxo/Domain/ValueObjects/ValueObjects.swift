import Foundation

enum TaskKind: String, Codable, Sendable, CaseIterable { case recurring, sporadic }
enum RoomKind: String, Codable, Sendable, CaseIterable { case wholeHouse, standard }
enum RoomVisibility: String, Codable, Sendable, CaseIterable { case common, privateRoom }

enum RoomCategory: String, Codable, Sendable, CaseIterable {
    case kitchen, bathroom, bedroom, livingRoom, laundry, office, outdoor, other
}

enum TaskAssignmentPolicy: String, Codable, Sendable, CaseIterable {
    case balancedAutomatically, calendarRotation, afterCompletion, selfAssigned
}

enum TaskOccurrenceStatus: String, Codable, Sendable { case available, assigned, completed }
enum RecurrenceFrequency: String, CaseIterable, Codable, Sendable { case daily, weekly, monthly, yearly }

enum RecurrencePolicy: Hashable, Codable, Sendable {
    case none
    case recurring(frequency: RecurrenceFrequency, interval: Int)
    case weekly(WeeklyPeriodicity)

    var isRepeating: Bool { self != .none }
    var hasValidInterval: Bool {
        switch self {
        case .none: true
        case let .recurring(_, interval): interval > 0
        case let .weekly(value): value.isValid
        }
    }
}

struct TaskEffort: Hashable, Codable, Sendable {
    let points: Int
    nonisolated init(points: Int) { self.points = min(max(points, 1), 3) }
}

struct WeeklyLoad: Hashable, Codable, Sendable {
    let points: Int
    nonisolated init(points: Int) { self.points = max(0, points) }
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

struct WeeklyPeriodicity: Hashable, Codable, Sendable {
    var executionsPerPeriod: Int = 1
    var intervalWeeks: Int = 1
    var isValid: Bool {
        intervalWeeks > 0 && intervalWeeks <= Int.max / 7
            && executionsPerPeriod > 0 && executionsPerPeriod <= intervalWeeks * 7
    }
    var label: String { "\(executionsPerPeriod) vez(es) a cada \(intervalWeeks) semana(s)" }
}

extension RecurrencePolicy {
    var weeklyPeriodicity: WeeklyPeriodicity? {
        switch self {
        case let .weekly(value): value
        case let .recurring(.weekly, interval): WeeklyPeriodicity(intervalWeeks: interval)
        default: nil
        }
    }
}
