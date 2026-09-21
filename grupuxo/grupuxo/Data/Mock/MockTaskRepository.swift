import Foundation

struct MockTaskRepository: TaskRepository {
    let store: MockStore
    let scheduling: TaskSchedulingService
    let eligibilityPolicy: TaskEligibilityPolicy

    init(store: MockStore, scheduling: TaskSchedulingService,
         eligibilityPolicy: TaskEligibilityPolicy = TaskEligibilityPolicy()) {
        self.store = store
        self.scheduling = scheduling
        self.eligibilityPolicy = eligibilityPolicy
    }

    func tasks(for userID: User.ID, in houseID: House.ID) async throws -> [TaskItem] {
        try await refreshSchedule(in: houseID, at: .now)
        return await store.read { state in
            guard state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == userID }) else { return [] }
            let roomsByID = Dictionary(uniqueKeysWithValues: state.rooms.map { ($0.id, $0) })
            return items(from: state).filter { item in
                guard let room = roomsByID[item.definition.roomID] else { return false }
                return room.houseID == houseID
                    && eligibilityPolicy.canView(
                        item.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
                    && item.occurrence.availableAt <= Date.now
                    && !item.occurrence.isCompleted
                    && (item.assignment?.userID == userID || item.definition.ownerUserID == userID)
            }
        }
    }

    func tasks(in roomID: Room.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        await store.read { state in
            guard let room = state.rooms.first(where: { $0.id == roomID }),
                  state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else { return [] }
            return items(from: state).filter {
                $0.definition.roomID == roomID
                    && $0.definition.kind != .sporadic
                    && eligibilityPolicy.canView(
                        $0.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
            }
        }
    }

    func sporadicTasks(in houseID: House.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        try await refreshSchedule(in: houseID, at: .now)
        return await store.read { state in
            guard state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == userID }) else { return [] }
            let roomsByID = Dictionary(uniqueKeysWithValues: state.rooms.map { ($0.id, $0) })
            return items(from: state).filter {
                guard let room = roomsByID[$0.definition.roomID] else { return false }
                return room.houseID == houseID
                    && $0.definition.kind == .sporadic
                    && eligibilityPolicy.canView(
                        $0.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
            }
        }
    }

    func create(_ definition: TaskDefinition, at date: Date) async throws -> TaskDefinition {
        try await store.update { state in
            var schedule = state.schedule
            if let room = schedule.rooms.first(where: { $0.id == definition.roomID }) {
                try scheduling.refresh(houseID: room.houseID, at: date, state: &schedule)
            }
            let created = try scheduling.create(definition, at: date, state: &schedule)
            state.schedule = schedule
            return created
        }
    }

    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await store.update { state in
            var schedule = state.schedule
            try scheduling.complete(occurrenceID: occurrenceID, by: userID, at: date, state: &schedule)
            state.schedule = schedule
        }
    }

    func refreshSchedule(in houseID: House.ID, at date: Date) async throws {
        try await store.update { state in
            var schedule = state.schedule
            try scheduling.refresh(houseID: houseID, at: date, state: &schedule)
            state.schedule = schedule
        }
    }

    func addMember(userID: User.ID, to roomID: Room.ID, at date: Date) async throws {
        try await store.update { state in
            var schedule = state.schedule
            try scheduling.addMember(userID: userID, roomID: roomID, at: date, state: &schedule)
            state.schedule = schedule
        }
    }

    func claim(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await store.update { state in
            guard let occurrence = state.occurrences.first(where: { $0.id == occurrenceID }),
                  let definition = state.definitions.first(where: { $0.id == occurrence.taskDefinitionID }),
                  let room = state.rooms.first(where: { $0.id == definition.roomID }) else {
                throw DomainError.entityNotFound
            }
            guard state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }),
                  state.roomMemberships.contains(where: { $0.roomID == room.id && $0.userID == userID }),
                  !state.absences.contains(where: { absence in
                      absence.startsAt <= date && date < absence.endsAt
                          && state.houseMemberships.contains(where: { $0.id == absence.membershipID && $0.userID == userID })
                  }), occurrence.availableAt <= date, !occurrence.isCompleted else {
                throw DomainError.taskUnavailable
            }
            let currentAssignment = state.assignments.first {
                $0.occurrenceID == occurrenceID && $0.endedAt == nil
            }
            let item = TaskItem(definition: definition, occurrence: occurrence, assignment: currentAssignment)
            guard eligibilityPolicy.canClaim(
                item,
                room: room,
                userID: userID,
                roomMemberships: state.roomMemberships
            ) || currentAssignment?.userID == userID else {
                throw DomainError.taskUnavailable
            }
            if let assignment = currentAssignment {
                guard assignment.userID == userID else { throw DomainError.taskUnavailable }
                return
            }
            state.assignments.append(
                TaskAssignment(id: UUID(), occurrenceID: occurrenceID, userID: userID, assignedAt: date, endedAt: nil)
            )
            if let occurrenceIndex = state.occurrences.firstIndex(where: { $0.id == occurrenceID }) {
                state.occurrences[occurrenceIndex].status = .assigned
            }
        }
    }

    func release(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws {
        try await store.update { state in
            guard let assignmentIndex = state.assignments.firstIndex(where: {
                $0.occurrenceID == occurrenceID && $0.userID == userID && $0.endedAt == nil
            }) else { return }
            guard let occurrence = state.occurrences.first(where: { $0.id == occurrenceID }),
                  !occurrence.isCompleted,
                  state.definitions.contains(where: { $0.id == occurrence.taskDefinitionID && $0.kind == .sporadic }) else {
                throw DomainError.taskUnavailable
            }
            state.assignments[assignmentIndex].endedAt = .now
            guard let occurrenceIndex = state.occurrences.firstIndex(where: { $0.id == occurrenceID }) else {
                throw DomainError.entityNotFound
            }
            state.occurrences[occurrenceIndex].status = .available
        }
    }

    nonisolated private func items(from state: MockStore.State) -> [TaskItem] {
        let definitionByID = Dictionary(uniqueKeysWithValues: state.definitions.map { ($0.id, $0) })
        return state.occurrences.compactMap { occurrence in
            guard let definition = definitionByID[occurrence.taskDefinitionID] else { return nil }
            let assignment = state.assignments.first { $0.occurrenceID == occurrence.id && $0.endedAt == nil }
            let assigneeID = assignment?.userID ?? occurrence.completedByUserID
            return TaskItem(definition: definition, occurrence: occurrence, assignment: assignment,
                            assignee: state.users.first { $0.id == assigneeID })
        }
    }
}
