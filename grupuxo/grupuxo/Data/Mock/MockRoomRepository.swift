import Foundation
import GrupuxoDomain

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
            var ids: [User.ID] = []
            if isMember, let version = updated.scheduleVersions.last(where: { $0.effectiveAt <= date }), !version.queue.isEmpty {
                for role in 0..<version.responsibleCount {
                    let slot = (period - version.periodIndex) * version.responsibleCount + role
                    let user = version.queue[slot % version.queue.count]
                    if let name = state.users.first(where: { $0.id == user })?.name {
                        names.append(name)
                        ids.append(user)
                    }
                }
            }
            return RoomParticipation(room: visibleRoom(updated, userID: userID, state: state), isMember: isMember, memberCount: isMember ? members.count : 0,
                responsibleNames: names, responsibleUserIDs: ids, periodStart: start, periodEnd: end)
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

    func update(roomID: Room.ID, patch: RoomPatch, requestedBy userID: User.ID, at date: Date) async throws -> Room {
        try await store.update { state in
            let index = try editableRoomIndex(roomID, userID: userID, state: state)
            if let name = patch.name { state.rooms[index].name = name }
            if let category = patch.category { state.rooms[index].category = category }
            if let icon = patch.icon { state.rooms[index].icon = icon }
            if let color = patch.color { state.rooms[index].color = color }
            if let periodicity = patch.periodicity { state.rooms[index].periodicity = periodicity }
            if let count = patch.responsibleCount { state.rooms[index].responsibleCount = count }
            guard state.rooms[index].periodicity.isValid, state.rooms[index].responsibleCount > 0 else {
                throw DomainError.invalidSchedule
            }
            if patch.periodicity != nil || patch.responsibleCount != nil {
                var schedule = state.schedule
                let houseID = state.rooms[index].houseID
                try scheduling.rebalance(
                    houseID: houseID, boundary: try scheduling.addingWeeks(1, to: try scheduling.weekStart(date)),
                    at: date, state: &schedule
                )
                state.schedule = schedule
            }
            return state.rooms.first { $0.id == roomID }!
        }
    }

    func delete(roomID: Room.ID, requestedBy userID: User.ID, at date: Date, confirmDeletion: Bool) async throws {
        try await store.update { state in
            _ = try editableRoomIndex(roomID, userID: userID, state: state)
            guard confirmDeletion else { throw DomainError.deletionConfirmationRequired }
            let definitionIDs = Set(state.definitions.filter { $0.roomID == roomID }.map(\.id))
            let occurrenceIDs = Set(state.occurrences.filter { definitionIDs.contains($0.taskDefinitionID) }.map(\.id))
            let swapIDs = Set(state.taskSwapRequests.filter {
                occurrenceIDs.contains($0.offeredOccurrenceID) || occurrenceIDs.contains($0.requestedOccurrenceID)
            }.map(\.id))
            state.assignments.removeAll { occurrenceIDs.contains($0.occurrenceID) }
            state.occurrences.removeAll { definitionIDs.contains($0.taskDefinitionID) }
            state.definitions.removeAll { definitionIDs.contains($0.id) }
            state.roomMemberships.removeAll { $0.roomID == roomID }
            state.roomAccessRequests.removeAll { $0.roomID == roomID }
            state.taskSwapRequests.removeAll { swapIDs.contains($0.id) }
            state.notifications.removeAll { notice in
                notice.swapRequestID.map(swapIDs.contains) == true
                    || notice.taskDefinitionID.map(definitionIDs.contains) == true
                    || notice.roomID == roomID
            }
            state.rooms.removeAll { $0.id == roomID }
        }
    }

    /// O cômodo que o morador pode alterar: da casa dele, privado só se participa; "Casa toda" não se altera.
    private func editableRoomIndex(_ roomID: Room.ID, userID: User.ID, state: MockStore.State) throws -> Int {
        guard let index = state.rooms.firstIndex(where: { $0.id == roomID }) else { throw DomainError.entityNotFound }
        let room = state.rooms[index]
        guard state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else {
            throw DomainError.entityNotFound
        }
        let participates = state.roomMemberships.contains { $0.roomID == roomID && $0.userID == userID && $0.isCurrent }
        if room.visibility == .privateRoom && !participates { throw DomainError.entityNotFound }
        if room.representsWholeHouse { throw DomainError.wholeHouseProtected }
        return index
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
