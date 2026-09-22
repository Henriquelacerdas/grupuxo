struct RotationCalculator: Sendable {
    func advance(index: Int, queue: [User.ID]) throws -> Int {
        guard queue.indices.contains(index) else { throw DomainError.invalidDistribution }
        return (index + 1) % queue.count
    }

    func nextUser(after currentUserID: User.ID?, eligibleUserIDs: [User.ID]) -> User.ID? {
        guard !eligibleUserIDs.isEmpty else { return nil }
        guard let currentUserID, let index = eligibleUserIDs.firstIndex(of: currentUserID) else {
            return eligibleUserIDs.first
        }
        return eligibleUserIDs[(index + 1) % eligibleUserIDs.count]
    }
}
