import Foundation

/// Ordered objectives, without arbitrary scalar weights that can invert priorities.
struct ScheduleCost: Comparable, Sendable {
    var effort: Double = 0
    var difficulty: Double = 0
    var debt: Double = 0
    var changes: Double = 0
    static let infinity = ScheduleCost(effort: .infinity)
    var isFinite: Bool { effort.isFinite && difficulty.isFinite && debt.isFinite && changes.isFinite }
    static func < (a: Self, b: Self) -> Bool {
        if a.effort != b.effort { return a.effort < b.effort }
        if a.difficulty != b.difficulty { return a.difficulty < b.difficulty }
        if a.debt != b.debt { return a.debt < b.debt }
        return a.changes < b.changes
    }
    static func + (a: Self, b: Self) -> Self {
        Self(effort: a.effort + b.effort, difficulty: a.difficulty + b.difficulty,
             debt: a.debt + b.debt, changes: a.changes + b.changes)
    }
    static func - (a: Self, b: Self) -> Self {
        Self(effort: a.effort - b.effort, difficulty: a.difficulty - b.difficulty,
             debt: a.debt - b.debt, changes: a.changes - b.changes)
    }
}

extension HungarianAlgorithm {
    /// Same potentials algorithm over lexicographically ordered additive costs.
    func solve(costs: [[ScheduleCost]]) throws -> [Int] {
        let n = costs.count
        guard costs.allSatisfy({ $0.count == n && $0.allSatisfy(\.isFinite) }) else {
            throw DomainError.invalidDistribution
        }
        guard n > 0 else { return [] }
        var u = Array(repeating: ScheduleCost(), count: n + 1)
        var v = u
        var p = Array(repeating: 0, count: n + 1)
        var way = p
        for row in 1...n {
            p[0] = row
            var column = 0
            var minimum = Array(repeating: ScheduleCost.infinity, count: n + 1)
            var used = Array(repeating: false, count: n + 1)
            repeat {
                used[column] = true
                let currentRow = p[column]
                var delta = ScheduleCost.infinity
                var next = 0
                for j in 1...n where !used[j] {
                    let cost = costs[currentRow - 1][j - 1] - u[currentRow] - v[j]
                    guard cost.isFinite else { throw DomainError.invalidDistribution }
                    if cost < minimum[j] { minimum[j] = cost; way[j] = column }
                    if minimum[j] < delta { delta = minimum[j]; next = j }
                }
                guard delta.isFinite else { throw DomainError.invalidDistribution }
                for j in 0...n {
                    if used[j] { u[p[j]] = u[p[j]] + delta; v[j] = v[j] - delta }
                    else { minimum[j] = minimum[j] - delta }
                }
                column = next
            } while p[column] != 0
            repeat {
                let previous = way[column]
                p[column] = p[previous]
                column = previous
            } while column != 0
        }
        var result = Array(repeating: 0, count: n)
        for j in 1...n { result[p[j] - 1] = j - 1 }
        return result
    }
}

struct QueueForecast: Sendable {
    struct Turn: Sendable {
        let week: Int
        let effort: Int
        let eligible: Set<User.ID>
        let incumbent: User.ID?
    }
    let participants: [User.ID]
    let turns: [Turn]
    let existingQueue: [User.ID] // Starts at the first replanned occurrence.
}

struct HouseQueueOptimizer: Sendable {
    typealias Grid = [User.ID: [ProjectedWeek]]

    func optimize(_ tasks: [QueueForecast], fixed: Grid, debts: [User.ID: Double]) throws -> [[User.ID]] {
        guard fixed.values.allSatisfy({ weeks in
            weeks.count == 12 && weeks.allSatisfy {
                $0.load.isFinite && $0.load >= 0 && $0.level1.isFinite && $0.level1 >= 0
                    && $0.level2.isFinite && $0.level2 >= 0 && $0.level3.isFinite && $0.level3 >= 0
            }
        }), debts.values.allSatisfy(\.isFinite), tasks.allSatisfy({ task in
            Set(task.participants).count == task.participants.count
                && Set(task.existingQueue).count == task.existingQueue.count && task.turns.allSatisfy {
                (0..<12).contains($0.week) && (1...3).contains($0.effort)
            }
        }) else { throw DomainError.invalidDistribution }
        let adapted = tasks.map { task in
            let retained = task.existingQueue.filter { task.participants.contains($0) }
            return retained + task.participants.filter { !retained.contains($0) }.sorted { $0.uuidString < $1.uuidString }
        }
        let rebuilt = tasks.map { $0.participants.sorted { $0.uuidString < $1.uuidString } }
        var best = adapted
        var bestCost = try score(tasks, queues: best, fixed: fixed, debts: debts)
        for initial in [adapted, rebuilt] {
            var queues = initial
            var cost = try score(tasks, queues: queues, fixed: fixed, debts: debts)
            for _ in 0..<20 {
                var improved = false
                for index in tasks.indices where !tasks[index].participants.isEmpty {
                    var base = fixed
                    for other in tasks.indices where other != index { add(tasks[other], queue: queues[other], to: &base) }
                    let task = tasks[index]
                    let users = task.participants.sorted { $0.uuidString < $1.uuidString }
                    let matrix = users.map { user in
                        users.indices.map { slot in
                            var weeks = base[user] ?? Array(repeating: ProjectedWeek(), count: 12)
                            var changes = 0.0
                            for turnIndex in task.turns.indices where turnIndex % users.count == slot {
                                let turn = task.turns[turnIndex]
                                let owner = turn.eligible.contains(user) ? user : nil
                                if owner != nil { weeks[turn.week].add(effort: turn.effort) }
                                if owner != turn.incumbent { changes += 1 }
                            }
                            var result = userCost(weeks, debt: debts[user, default: 0])
                            result.changes = changes
                            return result
                        }
                    }
                    let assignment = try HungarianAlgorithm().solve(costs: matrix)
                    var candidate = queues
                    for row in users.indices { candidate[index][assignment[row]] = users[row] }
                    let candidateCost = try score(tasks, queues: candidate, fixed: fixed, debts: debts)
                    if candidateCost < cost { queues = candidate; cost = candidateCost; improved = true }
                }
                if !improved { break }
            }
            if cost < bestCost { best = queues; bestCost = cost }
        }
        return best
    }

    func score(_ tasks: [QueueForecast], queues: [[User.ID]], fixed: Grid,
               debts: [User.ID: Double]) throws -> ScheduleCost {
        var grid = fixed
        var result = ScheduleCost()
        for i in tasks.indices {
            add(tasks[i], queue: queues[i], to: &grid)
            for j in tasks[i].turns.indices {
                let turn = tasks[i].turns[j]
                let nominal = queues[i].isEmpty ? nil : queues[i][j % queues[i].count]
                let owner = nominal.flatMap { turn.eligible.contains($0) ? $0 : nil }
                if owner != turn.incumbent { result.changes += 1 }
            }
        }
        for user in grid.keys.sorted(by: { $0.uuidString < $1.uuidString }) {
            result = result + userCost(grid[user]!, debt: debts[user, default: 0])
        }
        guard result.isFinite else { throw DomainError.invalidDistribution }
        return result
    }

    private func add(_ task: QueueForecast, queue: [User.ID], to grid: inout Grid) {
        guard !queue.isEmpty else { return }
        for (i, turn) in task.turns.enumerated() {
            let user = queue[i % queue.count]
            guard turn.eligible.contains(user) else { continue }
            var weeks = grid[user] ?? Array(repeating: ProjectedWeek(), count: 12)
            weeks[turn.week].add(effort: turn.effort)
            grid[user] = weeks
        }
    }

    private func userCost(_ weeks: [ProjectedWeek], debt: Double) -> ScheduleCost {
        weeks.reduce(ScheduleCost()) { total, week in
            total + ScheduleCost(effort: week.load * week.load,
                difficulty: week.level1 * week.level1 + week.level2 * week.level2 + week.level3 * week.level3,
                debt: 2 * week.load * debt / 12)
        }
    }
}
