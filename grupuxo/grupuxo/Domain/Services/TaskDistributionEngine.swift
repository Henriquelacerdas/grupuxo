import Foundation

/// A single resident/week bucket. No entities or UUID allocation inside cost loops.
struct ProjectedWeek: Sendable {
    var load: Double = 0
    var level1: Double = 0
    var level2: Double = 0
    var level3: Double = 0

    mutating func add(effort: Int) {
        load += Double(effort)
        switch effort {
        case 1: level1 += 1
        case 2: level2 += 1
        default: level3 += 1
        }
    }

    func cost(debt: Double) -> Double {
        let adjusted = load + debt
        return adjusted * adjusted + 0.5 * (level1 * level1 + level2 * level2 + level3 * level3)
    }
}

struct TaskDistributionEngine: Sendable {
    let optimizer: HungarianAlgorithm

    init(optimizer: HungarianAlgorithm = HungarianAlgorithm()) { self.optimizer = optimizer }

    /// weeks lists the week index of each chronological occurrence (duplicates allowed).
    func generateInitialQueue(
        taskEffort: Int,
        participants: [User.ID],
        occurrenceWeeks: [Int],
        projection: [User.ID: [ProjectedWeek]],
        debts: [User.ID: Double]
    ) throws -> [User.ID] {
        try validate(effort: taskEffort, queue: participants, weeks: occurrenceWeeks,
                     projection: projection, debts: debts)
        guard !participants.isEmpty else { throw DomainError.noEligibleMembers }
        let count = participants.count
        let matrix = participants.map { user in
            (0..<count).map { slot in
                var weeks = projection[user] ?? Array(repeating: ProjectedWeek(), count: 12)
                for index in occurrenceWeeks.indices where index % count == slot {
                    weeks[occurrenceWeeks[index]].add(effort: taskEffort)
                }
                return weeks.reduce(0) { $0 + $1.cost(debt: debts[user, default: 0] / 12) }
            }
        }
        let assignment = try optimizer.solve(matrix: matrix)
        var queue = participants
        for row in participants.indices { queue[assignment[row]] = participants[row] }
        return queue
    }

    /// The cursor points to the first UNPUBLISHED slot. Published occurrences are never inputs to mutate.
    func insertNewMember(
        newUser: User.ID,
        currentQueue: [User.ID],
        currentRotationIndex: Int,
        taskEffort: Int,
        occurrenceWeeks: [Int],
        projection: [User.ID: [ProjectedWeek]],
        debts: [User.ID: Double]
    ) throws -> [User.ID] {
        try validate(effort: taskEffort, queue: currentQueue, weeks: occurrenceWeeks,
                     projection: projection, debts: debts)
        guard !currentQueue.contains(newUser) else { return currentQueue }
        guard !currentQueue.isEmpty else { return [newUser] }
        guard currentQueue.indices.contains(currentRotationIndex) else { throw DomainError.invalidDistribution }
        var bestQueue = currentQueue
        var minimum = Double.infinity
        // Preserve the next resident too; every candidate keeps the old members' relative order.
        for position in (currentRotationIndex + 1)...currentQueue.count {
            var candidate = currentQueue
            candidate.insert(newUser, at: position)
            var grid = projection
            for user in candidate where grid[user] == nil {
                grid[user] = Array(repeating: ProjectedWeek(), count: 12)
            }
            for (offset, week) in occurrenceWeeks.enumerated() {
                let user = candidate[(currentRotationIndex + offset) % candidate.count]
                grid[user]![week].add(effort: taskEffort)
            }
            let cost = candidate.reduce(0.0) { total, user in
                total + grid[user]!.reduce(0) { $0 + $1.cost(debt: debts[user, default: 0] / 12) }
            }
            guard cost.isFinite else { throw DomainError.invalidDistribution }
            if cost < minimum { minimum = cost; bestQueue = candidate }
        }
        return bestQueue
    }

    private func validate(effort: Int, queue: [User.ID], weeks: [Int],
                          projection: [User.ID: [ProjectedWeek]], debts: [User.ID: Double]) throws {
        guard (1...3).contains(effort), Set(queue).count == queue.count,
              weeks.allSatisfy({ (0..<12).contains($0) }),
              debts.values.allSatisfy(\.isFinite),
              projection.values.allSatisfy({ weeks in
                  weeks.count == 12 && weeks.allSatisfy {
                      $0.load.isFinite && $0.load >= 0
                          && $0.level1.isFinite && $0.level1 >= 0
                          && $0.level2.isFinite && $0.level2 >= 0
                          && $0.level3.isFinite && $0.level3 >= 0
                  }
              }) else { throw DomainError.invalidDistribution }
    }
}
