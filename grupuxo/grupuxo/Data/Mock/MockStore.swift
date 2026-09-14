actor MockStore {
    struct State: Sendable {
        var users: [User]
        var houses: [House]
        var houseMemberships: [HouseMembership]
        var rooms: [Room]
        var roomMemberships: [RoomMembership]
        var definitions: [TaskDefinition]
        var occurrences: [TaskOccurrence]
        var assignments: [TaskAssignment]
        var absences: [Absence]
        var roomAccessRequests: [RoomAccessRequest]
    }

    private var state: State

    init(state: State = MockSeed.make()) {
        self.state = state
    }

    func read<T: Sendable>(_ transform: @Sendable (State) throws -> T) rethrows -> T {
        try transform(state)
    }

    func update<T: Sendable>(_ transform: @Sendable (inout State) throws -> T) rethrows -> T {
        try transform(&state)
    }
}
