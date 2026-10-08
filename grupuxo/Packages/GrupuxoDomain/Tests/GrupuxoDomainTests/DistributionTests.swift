import Foundation
import Testing
@testable import GrupuxoDomain

struct DistributionTests {
    let engine = TaskDistributionEngine()
    let solver = HungarianAlgorithm()

    @Test func knownOptimumAndNegativeCosts() throws {
        #expect(try solver.solve(matrix: [[4, 1, 3], [2, 0, 5], [3, 2, 2]]) == [1, 0, 2])
        #expect(try solver.solve(matrix: [[-4, -1], [-2, -5]]) == [0, 1])
        #expect(try solver.solve(matrix: []) == [])
        #expect(try solver.solve(matrix: [[3]]) == [0])
        #expect(try solver.solve(matrix: [[0, 0], [0, 0]]) == [0, 1])
    }

    @Test func malformedMatricesFail() {
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[1, 2]]) }
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[.nan]]) }
        #expect(throws: DomainError.invalidDistribution) { try solver.solve(matrix: [[.infinity]]) }
    }

    @Test func optimumMatchesExhaustiveSearch() throws {
        // Independent oracle over every permutation, several sizes and negative/tied costs.
        for n in 1...6 {
            for seed in 0..<8 {
                let matrix = (0..<n).map { row in
                    (0..<n).map { col in Double(((row + 3) * (col + seed + 1) * 17 + col * col) % 29 - 14) }
                }
                let assignment = try solver.solve(matrix: matrix)
                let cost = assignment.enumerated().reduce(0.0) { $0 + matrix[$1.offset][$1.element] }
                let oracle = permutations(Array(0..<n)).map { candidate in
                    candidate.enumerated().reduce(0.0) { $0 + matrix[$1.offset][$1.element] }
                }.min()!
                #expect(cost == oracle)
                #expect(Set(assignment).count == n)
            }
        }
    }

    @Test func weeklyPeaksDeterminePhase() throws {
        let a = UUID(), b = UUID()
        var aWeeks = Array(repeating: ProjectedWeek(), count: 12)
        var bWeeks = aWeeks
        for week in 0..<12 {
            if week.isMultiple(of: 2) { aWeeks[week].add(effort: 3) }
            else { bWeeks[week].add(effort: 3) }
        }
        let queue = try engine.generateInitialQueue(taskEffort: 3, participants: [a, b],
                                                    occurrenceWeeks: Array(0..<12),
                                                    projection: [a: aWeeks, b: bWeeks], debts: [:])
        #expect(queue == [b, a])
    }

    @Test func positiveDebtDelaysFirstTurnAndQueueIsPermutation() throws {
        let a = UUID(), b = UUID(), c = UUID()
        let queue = try engine.generateInitialQueue(taskEffort: 2, participants: [a, b, c],
                                                    occurrenceWeeks: [0], projection: [:], debts: [a: 12, b: -12])
        #expect(queue.first == b)
        #expect(Set(queue) == Set([a, b, c]))
        #expect(queue.count == 3)
    }

    @Test func fairnessIsZeroSumAndDeduplicatesMembers() throws {
        let a = UUID(), b = UUID(), c = UUID()
        let result = try FairnessCalculator().calculateDebtImpact(effort: 2, executorID: a,
                                                                  eligibleUserIDs: [a, b, c, a])
        #expect(abs(result.values.reduce(0, +)) < 1e-12)
        #expect(abs(result[a]! - 4.0 / 3) < 1e-12)
        #expect(result[b] == result[c])
        #expect(throws: DomainError.invalidDistribution) {
            try FairnessCalculator().calculateDebtImpact(effort: 2, executorID: UUID(), eligibleUserIDs: [a])
        }
        #expect(try FairnessCalculator().calculateDebtImpact(effort: 3, executorID: a, eligibleUserIDs: [a]) == [a: 0])
    }

    @Test func difficultyMixBreaksEqualLoadTie() throws {
        let a = UUID(), b = UUID()
        var aWeeks = Array(repeating: ProjectedWeek(), count: 12)
        var bWeeks = aWeeks
        aWeeks[0].add(effort: 3)
        for _ in 0..<3 { bWeeks[0].add(effort: 1) }
        let queue = try engine.generateInitialQueue(taskEffort: 3, participants: [a, b],
                                                    occurrenceWeeks: [0], projection: [a: aWeeks, b: bWeeks], debts: [:])
        #expect(queue.first == b)
    }

    @Test func invalidEngineInputsFail() {
        let a = UUID()
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a, a],
                                             occurrenceWeeks: [0], projection: [:], debts: [:])
        }
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a],
                                             occurrenceWeeks: [12], projection: [:], debts: [:])
        }
        #expect(throws: DomainError.invalidDistribution) {
            try engine.generateInitialQueue(taskEffort: 2, participants: [a],
                                             occurrenceWeeks: [0], projection: [:], debts: [a: .nan])
        }
    }

    private func permutations(_ values: [Int]) -> [[Int]] {
        guard let first = values.first else { return [[]] }
        return permutations(Array(values.dropFirst())).flatMap { tail in
            (0...tail.count).map { index in
                var result = tail
                result.insert(first, at: index)
                return result
            }
        }
    }
}
