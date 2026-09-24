import Foundation

extension TaskSchedulingService {
    func isRoomLinked(_ definition: TaskDefinition, state: TaskSchedulingState) -> Bool {
        definition.kind == .recurring && definition.assignmentPolicy != .afterCompletion
            && definition.assignmentPolicy != .selfAssigned
            && state.rooms.contains { $0.id == definition.roomID && definition.recurrence.weeklyPeriodicity == $0.periodicity }
    }

    func initializeRooms(houseID: House.ID, at date: Date, state: inout TaskSchedulingState) throws {
        for i in state.rooms.indices where state.rooms[i].houseID == houseID {
            guard state.rooms[i].periodicity.isValid, state.rooms[i].responsibleCount > 0 else { throw DomainError.invalidSchedule }
            if state.rooms[i].calendarAnchor == nil { state.rooms[i].calendarAnchor = try weekStart(date) }
            if state.rooms[i].scheduleVersions.isEmpty {
                try configureRoom(roomID: state.rooms[i].id, boundary: state.rooms[i].calendarAnchor!, state: &state)
            }
        }
    }

    func periodIndex(room: Room, date: Date) throws -> Int {
        guard let anchor = room.calendarAnchor,
              let days = calendar.dateComponents([.day], from: anchor, to: calendar.startOfDay(for: date)).day else {
            throw DomainError.invalidSchedule
        }
        return max(0, days / (7 * room.periodicity.intervalWeeks))
    }

    func configureRoom(roomID: Room.ID, boundary: Date, state: inout TaskSchedulingState) throws {
        guard let ri = state.rooms.firstIndex(where: { $0.id == roomID }) else { throw DomainError.entityNotFound }
        let room = state.rooms[ri]
        let houseUsers = Set(state.houseMemberships.filter { $0.houseID == room.houseID }.map(\.userID))
        let users = Set(state.roomMemberships.filter {
            $0.roomID == roomID && $0.participates(at: boundary) && houseUsers.contains($0.userID)
        }.map(\.userID)).sorted { $0.uuidString < $1.uuidString }
        let previous = room.scheduleVersions.last { $0.effectiveAt <= boundary }
        let retained = (previous?.queue ?? []).filter { users.contains($0) }
        let queue = retained + users.filter { !retained.contains($0) }
        let count = min(room.responsibleCount, queue.count)
        var loads = Array(repeating: 0, count: count)
        var amounts = loads
        var roles: [UUID: Int] = [:]
        let tasks = state.definitions.filter { $0.roomID == roomID && isRoomLinked($0, state: state) }.sorted {
            $0.effort.points == $1.effort.points ? $0.id.uuidString < $1.id.uuidString : $0.effort.points > $1.effort.points
        }
        if count > 0 {
            for task in tasks {
                let role = (0..<count).min {
                    if loads[$0] != loads[$1] { return loads[$0] < loads[$1] }
                    if amounts[$0] != amounts[$1] { return amounts[$0] < amounts[$1] }
                    return $0 < $1
                }!
                roles[task.id] = role
                loads[role] += task.effort.points
                amounts[role] += 1
            }
        }
        // Preserve phase for unchanged membership, including task creation mid-period.
        let index = try periodIndex(room: room, date: boundary)
        var phasedQueue = queue
        if let previous, previous.queue == queue, !queue.isEmpty {
            let shift = ((index - previous.periodIndex) * previous.responsibleCount) % queue.count
            phasedQueue = Array(queue[shift...] + queue[..<shift])
        }
        let version = RoomScheduleVersion(effectiveAt: boundary, queue: phasedQueue,
            responsibleCount: count, taskRoles: roles, periodIndex: index)
        state.rooms[ri].scheduleVersions.removeAll { $0.effectiveAt >= boundary }
        state.rooms[ri].scheduleVersions.append(version)
    }

    func roomSlot(room: Room, version: RoomScheduleVersion, taskID: UUID, date: Date) throws -> Int {
        let period = try periodIndex(room: room, date: date)
        return max(0, period - version.periodIndex) * version.responsibleCount + (version.taskRoles[taskID] ?? 0)
    }

    func roomOwner(definition: TaskDefinition, date: Date, state: TaskSchedulingState) throws -> User.ID? {
        let room = try room(for: definition, state: state)
        guard let version = room.scheduleVersions.last(where: { $0.effectiveAt <= date }),
              !version.queue.isEmpty, version.taskRoles[definition.id] != nil else { return nil }
        let slot = try roomSlot(room: room, version: version, taskID: definition.id, date: date)
        let owner = version.queue[slot % version.queue.count]
        return try members(for: definition, at: date, state: state).contains(owner) ? owner : nil
    }

    func firstWeeklyDate(onOrAfter date: Date, definition: TaskDefinition) throws -> Date {
        guard let period = definition.recurrence.weeklyPeriodicity, period.isValid else { throw DomainError.invalidSchedule }
        let anchor = try definition.calendarAnchor ?? weekStart(date)
        let days = calendar.dateComponents([.day], from: anchor, to: calendar.startOfDay(for: date)).day ?? 0
        let length = period.intervalWeeks * 7
        var cycle = max(0, days / length)
        while true {
            for i in 0..<period.executionsPerPeriod {
                // Exact integer floor without overflowing the intermediate product.
                let offset = period.executionsPerPeriod.dividingFullWidth(i.multipliedFullWidth(by: length)).quotient
                let candidate = try adding(.day, cycle * length + offset, to: anchor)
                if candidate >= date { return candidate }
            }
            cycle += 1
        }
    }

    func deleteRoom(_ roomID: Room.ID, state: inout TaskSchedulingState) {
        let definitions = Set(state.definitions.filter { $0.roomID == roomID }.map(\.id))
        let occurrences = Set(state.occurrences.filter { definitions.contains($0.taskDefinitionID) }.map(\.id))
        state.assignments.removeAll { occurrences.contains($0.occurrenceID) }
        state.occurrences.removeAll { definitions.contains($0.taskDefinitionID) }
        state.definitions.removeAll { definitions.contains($0.id) }
        state.roomMemberships.removeAll { $0.roomID == roomID }
        state.rooms.removeAll { $0.id == roomID }
    }
}
