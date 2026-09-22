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

        var schedule: TaskSchedulingState {
            get {
                TaskSchedulingState(rooms: rooms, houseMemberships: houseMemberships,
                                    roomMemberships: roomMemberships, definitions: definitions,
                                    occurrences: occurrences, assignments: assignments, absences: absences)
            }
            set {
                rooms = newValue.rooms
                houseMemberships = newValue.houseMemberships
                roomMemberships = newValue.roomMemberships
                definitions = newValue.definitions
                occurrences = newValue.occurrences
                assignments = newValue.assignments
                absences = newValue.absences
            }
        }
    }

    private var state: State

    init(state: State = MockSeed.make()) {
        self.state = state
    }

    func read<T: Sendable>(_ transform: @Sendable (State) throws -> T) rethrows -> T {
        try transform(state)
    }

    func update<T: Sendable>(_ transform: @Sendable (inout State) throws -> T) rethrows -> T {
        // No suspension inside this transaction. A thrown error discards all mutations.
        var candidate = state
        let result = try transform(&candidate)
        state = candidate
        return result
    }
}
