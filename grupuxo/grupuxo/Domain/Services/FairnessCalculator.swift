import Foundation

struct FairnessCalculator: Sendable {
    func calculateDebtImpact(
        effort: Int,
        executorID: User.ID,
        eligibleUserIDs: [User.ID]
    ) throws -> [User.ID: Double] {
        let members = Set(eligibleUserIDs)
        guard (1...3).contains(effort), !members.isEmpty, members.contains(executorID) else {
            throw DomainError.invalidDistribution
        }
        let share = Double(effort) / Double(members.count)
        return Dictionary(uniqueKeysWithValues: members.map {
            ($0, ($0 == executorID ? Double(effort) : 0) - share)
        })
    }
}
