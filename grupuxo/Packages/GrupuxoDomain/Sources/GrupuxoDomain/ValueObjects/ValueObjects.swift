import Foundation

public enum TaskKind: String, Codable, Sendable, CaseIterable { case recurring, sporadic }
public enum RoomKind: String, Codable, Sendable, CaseIterable { case wholeHouse, standard }
public enum RoomVisibility: String, Codable, Sendable, CaseIterable { case common, privateRoom }

public enum RoomCategory: String, Codable, Sendable, CaseIterable {
    case kitchen, bathroom, bedroom, livingRoom, laundry, office, outdoor, other
}

public enum TaskAssignmentPolicy: String, Codable, Sendable, CaseIterable {
    case balancedAutomatically, calendarRotation, afterCompletion, selfAssigned
}

public enum TaskOccurrenceStatus: String, Codable, Sendable { case available, assigned, completed }
public enum RecurrenceFrequency: String, CaseIterable, Codable, Sendable { case daily, weekly, monthly, yearly }

public enum RecurrencePolicy: Hashable, Codable, Sendable {
    case none
    case recurring(frequency: RecurrenceFrequency, interval: Int)
    case weekly(WeeklyPeriodicity)

    public var isRepeating: Bool { self != .none }
    public var hasValidInterval: Bool {
        switch self {
        case .none: true
        case let .recurring(_, interval): interval > 0
        case let .weekly(value): value.isValid
        }
    }
}

public struct TaskEffort: Hashable, Codable, Sendable {
    public let points: Int
    public nonisolated init(points: Int) {
        self.points = min(max(points, TaskEffortLevel.light.rawValue), TaskEffortLevel.intense.rawValue)
    }
}

public enum TaskEffortLevel: Int, CaseIterable, Sendable, Identifiable {
    case light = 1
    case medium
    case intense

    public var id: Int { rawValue }
}

public struct WeeklyLoad: Hashable, Codable, Sendable {
    public let points: Int
    public nonisolated init(points: Int) { self.points = max(0, points) }
}

public struct DateIntervalValue: Hashable, Codable, Sendable {
    public let start: Date
    public let end: Date
    public nonisolated init(start: Date, end: Date) throws {
        guard start <= end else { throw DomainError.invalidDateInterval }
        self.start = start
        self.end = end
    }
}

public struct WeeklyPeriodicity: Hashable, Codable, Sendable {
    public var executionsPerPeriod: Int = 1
    public var intervalWeeks: Int = 1

    public init(executionsPerPeriod: Int = 1, intervalWeeks: Int = 1) {
        self.executionsPerPeriod = executionsPerPeriod
        self.intervalWeeks = intervalWeeks
    }
    public var isValid: Bool {
        intervalWeeks > 0 && intervalWeeks <= Int.max / 7
            && executionsPerPeriod > 0 && executionsPerPeriod <= intervalWeeks * 7
    }
    public var label: String { "\(executionsPerPeriod) vez(es) a cada \(intervalWeeks) semana(s)" }
}

extension RecurrencePolicy {
    public var weeklyPeriodicity: WeeklyPeriodicity? {
        switch self {
        case let .weekly(value): value
        case let .recurring(.weekly, interval): WeeklyPeriodicity(intervalWeeks: interval)
        default: nil
        }
    }
}
