import Foundation

/// Counts each occurrence once, in its availability week, using its effort snapshot.
struct WeeklyLoadCalculator: Sendable {
    func calculate(for userID: User.ID, assignments: [TaskAssignment], occurrences: [TaskOccurrence],
                   referenceDate: Date, calendar: Calendar = .current) -> WeeklyLoad {
        var calendar = calendar
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        guard let week = calendar.dateInterval(of: .weekOfYear, for: referenceDate) else { return WeeklyLoad(points: 0) }
        let owned = Set(assignments.filter { $0.userID == userID && $0.isActive }.map(\.occurrenceID))
        let points = occurrences.filter {
            week.contains($0.availableAt) && $0.availableAt < week.end
                && ($0.isCompleted ? $0.completedByUserID == userID : owned.contains($0.id))
        }.reduce(0) { $0 + $1.effortSnapshot.points }
        return WeeklyLoad(points: points)
    }
}
