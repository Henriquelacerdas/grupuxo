struct RotationCalculator: Sendable {
    func nextUser(after currentUserID: User.ID?, eligibleUserIDs: [User.ID]) -> User.ID? {
        guard !eligibleUserIDs.isEmpty else { return nil }
        guard let currentUserID, let index = eligibleUserIDs.firstIndex(of: currentUserID) else {
            return eligibleUserIDs.first
        }
        return eligibleUserIDs[(index + 1) % eligibleUserIDs.count]
    }
}
