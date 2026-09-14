import Foundation

struct WeeklyLoadCalculator: Sendable {
    func calculate(for userID: User.ID, assignments: [TaskAssignment], occurrences: [TaskOccurrence], referenceDate: Date, calendar: Calendar = .current) -> WeeklyLoad {
        guard let week = calendar.dateInterval(of: .weekOfYear, for: referenceDate) else { return WeeklyLoad(points: 0) }
        let occurrenceByID = Dictionary(uniqueKeysWithValues: occurrences.map { ($0.id, $0) })
        let points = assignments
            .filter {
                $0.userID == userID
                    && $0.assignedAt < week.end
                    && ($0.endedAt ?? .distantFuture) >= week.start
            }
            .compactMap { occurrenceByID[$0.occurrenceID]?.effortSnapshot.points }
            .reduce(0, +)
        return WeeklyLoad(points: points)
    }
}
