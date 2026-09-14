import Foundation

struct TaskDistributionDecision: Hashable, Sendable {
    let occurrenceID: TaskOccurrence.ID
    let userID: User.ID
}

struct TaskDistributionEngine: Sendable {
    func distribute(
        tasks: [TaskItem],
        eligibleUserIDsByRoom: [Room.ID: [User.ID]],
        currentLoads: [User.ID: WeeklyLoad],
        absentUserIDs: Set<User.ID>,
        previousAssigneeByTask: [TaskDefinition.ID: User.ID]
    ) -> [TaskDistributionDecision] {
        var projectedLoads = currentLoads.mapValues(\.points)
        var decisions: [TaskDistributionDecision] = []

        let orderedTasks = tasks
            .filter { item in
                let hasNoAssignment = item.assignment.map { _ in false } ?? true
                return !item.occurrence.isCompleted && hasNoAssignment
            }
            .sorted { $0.occurrence.effortSnapshot.points > $1.occurrence.effortSnapshot.points }

        for task in orderedTasks {
            let candidates = (eligibleUserIDsByRoom[task.definition.roomID] ?? [])
                .filter { !absentUserIDs.contains($0) }
            guard let selectedUserID = candidates.min(by: { lhs, rhs in
                let lhsKey = candidateKey(
                    userID: lhs,
                    load: projectedLoads[lhs, default: 0],
                    previousUserID: previousAssigneeByTask[task.definition.id]
                )
                let rhsKey = candidateKey(
                    userID: rhs,
                    load: projectedLoads[rhs, default: 0],
                    previousUserID: previousAssigneeByTask[task.definition.id]
                )
                return lhsKey < rhsKey
            }) else { continue }

            decisions.append(TaskDistributionDecision(occurrenceID: task.id, userID: selectedUserID))
            projectedLoads[selectedUserID, default: 0] += task.occurrence.effortSnapshot.points
        }

        return decisions
    }

    private func candidateKey(userID: User.ID, load: Int, previousUserID: User.ID?) -> String {
        let repetitionPenalty = userID == previousUserID ? 1 : 0
        return String(format: "%08d-%d-%@", load, repetitionPenalty, userID.uuidString)
    }
}
