import Foundation

struct MockRoomRepository: RoomRepository {
    let store: MockStore
    var scheduling = TaskSchedulingService(calendar: Calendar(identifier: .gregorian))

    func room(id: Room.ID, requesting userID: User.ID) async throws -> Room {
        try await store.read { state in
            guard let room = state.rooms.first(where: { $0.id == id }),
                  state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else {
                throw DomainError.entityNotFound
            }
            return visibleRoom(room, userID: userID, state: state)
        }
    }

    func rooms(in houseID: House.ID, requesting userID: User.ID) async throws -> [Room] {
        try await store.read { state in
            guard state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == userID }) else { throw DomainError.entityNotFound }
            return state.rooms.filter { $0.houseID == houseID }.map { visibleRoom($0, userID: userID, state: state) }
        }
    }

    func participation(in roomID: Room.ID, requesting userID: User.ID, at date: Date) async throws -> RoomParticipation {
        try await store.update { state in
            guard let room = state.rooms.first(where: { $0.id == roomID }),
                  state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else { throw DomainError.entityNotFound }
            var schedule = state.schedule
            try scheduling.initializeRooms(houseID: room.houseID, at: date, state: &schedule)
            state.schedule = schedule
            let updated = state.rooms.first { $0.id == roomID }!
            let members = state.roomMemberships.filter { $0.roomID == roomID && $0.isCurrent }
            let isMember = members.contains { $0.userID == userID }
            let period = try scheduling.periodIndex(room: updated, date: date)
            let start = try scheduling.addingWeeks(period * updated.periodicity.intervalWeeks, to: updated.calendarAnchor!)
            let end = try scheduling.addingWeeks(updated.periodicity.intervalWeeks, to: start)
            var names: [String] = []
            if isMember, let version = updated.scheduleVersions.last(where: { $0.effectiveAt <= date }), !version.queue.isEmpty {
                for role in 0..<version.responsibleCount {
                    let slot = (period - version.periodIndex) * version.responsibleCount + role
                    let user = version.queue[slot % version.queue.count]
                    if let name = state.users.first(where: { $0.id == user })?.name { names.append(name) }
                }
            }
            return RoomParticipation(room: visibleRoom(updated, userID: userID, state: state), isMember: isMember, memberCount: isMember ? members.count : 0,
                responsibleNames: names, periodStart: start, periodEnd: end)
        }
    }

    private func visibleRoom(_ room: Room, userID: User.ID, state: MockStore.State) -> Room {
        var result = room
        if !state.roomMemberships.contains(where: { $0.roomID == room.id && $0.userID == userID && $0.isCurrent }) {
            // Schedule versions contain task IDs and must not cross the access boundary.
            result.scheduleVersions = []
        }
        return result
    }

    func create(_ room: Room, memberships: [RoomMembership]) async throws -> Room {
        try await store.update { state in
            let users = Set(state.houseMemberships.filter { $0.houseID == room.houseID }.map(\.userID))
            let participants = Set(memberships.map(\.userID))
            guard state.houses.contains(where: { $0.id == room.houseID }), !participants.isEmpty, participants.count == memberships.count,
                  participants.isSubset(of: users), memberships.allSatisfy({ $0.roomID == room.id && $0.isCurrent }),
                  room.visibility != .common || participants == users,
                  !room.representsWholeHouse || room.visibility == .common else { throw DomainError.invalidRoomParticipants }
            guard room.periodicity.isValid, room.responsibleCount > 0 else { throw DomainError.invalidSchedule }
            if let existing = state.rooms.first(where: { $0.id == room.id }) { return existing }
            state.rooms.append(room)
            state.roomMemberships.append(contentsOf: memberships)
            var schedule = state.schedule
            try scheduling.initializeRooms(houseID: room.houseID, at: room.calendarAnchor ?? .now, state: &schedule)
            state.schedule = schedule
            return state.rooms.first { $0.id == room.id }!
        }
    }
}
