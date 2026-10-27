import Foundation

/// Consultas por cômodo que viram uma chamada à `api` cada: até este tanto ao mesmo tempo. Limita a concorrência na
/// Lambda e os conflitos de `version` das leituras que replanejam no servidor.
let maxConcurrentRoomQueries = 4

extension Array where Element: Sendable {

    /// `map` assíncrono com até `limit` transformações ao mesmo tempo; o resultado sai na ordem original. O primeiro
    /// erro cancela as demais e é relançado.
    func concurrentMap<T: Sendable>(
        limit: Int,
        _ transform: @escaping @Sendable (Element) async throws -> T
    ) async throws -> [T] {
        try await withThrowingTaskGroup(of: (Int, T).self) { group in
            var results = [T?](repeating: nil, count: count)
            var next = 0

            while next < Swift.min(Swift.max(limit, 1), count) {
                let index = next
                let element = self[index]
                group.addTask { (index, try await transform(element)) }
                next += 1
            }

            while let (index, value) = try await group.next() {
                results[index] = value
                if next < count {
                    let following = next
                    let element = self[following]
                    group.addTask { (following, try await transform(element)) }
                    next += 1
                }
            }

            return results.compactMap { $0 }
        }
    }
}
