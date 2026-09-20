import Foundation

/// Minimum-cost bijection: result[row] is its unique column. O(n³) time, O(n) workspace.
struct HungarianAlgorithm: Sendable {
    func solve(matrix: [[Double]]) throws -> [Int] {
        let n = matrix.count
        guard matrix.allSatisfy({ $0.count == n && $0.allSatisfy(\.isFinite) }) else {
            throw DomainError.invalidDistribution
        }
        guard n > 0 else { return [] }
        var u = [Double](repeating: 0, count: n + 1)
        var v = u
        var p = [Int](repeating: 0, count: n + 1)
        var way = p
        for row in 1...n {
            p[0] = row
            var column = 0
            var minimum = [Double](repeating: .infinity, count: n + 1)
            var used = [Bool](repeating: false, count: n + 1)
            repeat {
                used[column] = true
                let currentRow = p[column]
                var delta = Double.infinity
                var nextColumn = 0
                for j in 1...n where !used[j] {
                    let cost = matrix[currentRow - 1][j - 1] - u[currentRow] - v[j]
                    guard cost.isFinite else { throw DomainError.invalidDistribution }
                    if cost < minimum[j] {
                        minimum[j] = cost
                        way[j] = column
                    }
                    if minimum[j] < delta {
                        delta = minimum[j]
                        nextColumn = j
                    }
                }
                guard delta.isFinite else { throw DomainError.invalidDistribution }
                for j in 0...n {
                    if used[j] {
                        u[p[j]] += delta
                        v[j] -= delta
                    } else { minimum[j] -= delta }
                }
                column = nextColumn
            } while p[column] != 0
            repeat {
                let previous = way[column]
                p[column] = p[previous]
                column = previous
            } while column != 0
        }
        var result = [Int](repeating: 0, count: n)
        for j in 1...n { result[p[j] - 1] = j - 1 }
        return result
    }
}
