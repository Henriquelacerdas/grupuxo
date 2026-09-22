import Foundation

/// Value snapshot used by domain transitions, independent of storage technology.
struct TaskSchedulingState: Sendable {
    var rooms: [Room]
    var houseMemberships: [HouseMembership]
    var roomMemberships: [RoomMembership]
    var definitions: [TaskDefinition]
    var occurrences: [TaskOccurrence]
    var assignments: [TaskAssignment]
    var absences: [Absence]
}

/// Synchronous domain transitions run inside the repository's transaction, never on MainActor.
struct TaskSchedulingService: Sendable {
    let distribution: TaskDistributionEngine
    let fairness: FairnessCalculator
    let rotation: RotationCalculator
    let calendar: Calendar

    init(distribution: TaskDistributionEngine = TaskDistributionEngine(),
         fairness: FairnessCalculator = FairnessCalculator(),
         rotation: RotationCalculator = RotationCalculator(), calendar: Calendar) {
        self.distribution = distribution
        self.fairness = fairness
        self.rotation = rotation
        var calendar = calendar
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        self.calendar = calendar
    }

    func create(_ input: TaskDefinition, at date: Date, state: inout TaskSchedulingState) throws -> TaskDefinition {
        if let existing = state.definitions.first(where: { $0.id == input.id }) { return existing }
        guard !input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        _ = try room(for: input, state: state)
        var definition = input
        definition.rotationQueue = []
        definition.currentRotationIndex = 0
        definition.nextScheduledAt = nil
        if definition.kind == .sporadic {
            guard definition.recurrence == .none, definition.assignmentPolicy == .selfAssigned else {
                throw DomainError.invalidSchedule
            }
            appendOccurrence(definition: definition, date: date, dueAt: nil, userID: nil, state: &state)
        } else {
            guard definition.assignmentPolicy != .selfAssigned else { throw DomainError.invalidSchedule }
            if definition.assignmentPolicy == .afterCompletion {
                definition.recurrence = .none
            } else {
                guard definition.recurrence.isRepeating,
                      definition.recurrence.hasValidInterval else {
                    throw DomainError.invalidSchedule
                }
            }
            let participants = try members(for: definition, at: nil, state: state)
            let start = try weekStart(date)
            let dates = definition.assignmentPolicy == .afterCompletion
                ? [date] : try scheduledDates(from: date, definition: definition, end: addingWeeks(12, to: start))
            definition.rotationQueue = try distribution.generateInitialQueue(
                taskEffort: definition.effort.points, participants: participants,
                occurrenceWeeks: try dates.map { try weekIndex($0, start: start) },
                projection: try projection(houseID: room(for: definition, state: state).houseID, start: start, state: state),
                debts: debts(for: definition.roomID, state: state)
            )
            if definition.assignmentPolicy == .afterCompletion {
                try publish(definition: &definition, at: date, dueAt: nil, state: &state)
            } else {
                definition.nextScheduledAt = date
                try extend(definition: &definition, through: addingWeeks(12, to: start), state: &state)
            }
        }
        state.definitions.append(definition)
        return definition
    }

    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date,
                  state: inout TaskSchedulingState) throws {
        guard let index = state.occurrences.firstIndex(where: { $0.id == occurrenceID }),
              let definitionIndex = state.definitions.firstIndex(where: { $0.id == state.occurrences[index].taskDefinitionID }) else {
            throw DomainError.entityNotFound
        }
        let occurrence = state.occurrences[index]
        if occurrence.isCompleted {
            guard occurrence.completedByUserID == userID else { throw DomainError.taskUnavailable }
            return
        }
        var definition = state.definitions[definitionIndex]
        let eligible = try members(for: definition, at: date, state: state)
        guard occurrence.availableAt <= date, eligible.contains(userID),
              state.assignments.contains(where: { $0.occurrenceID == occurrenceID && $0.isActive && $0.userID == userID }) else {
            throw DomainError.taskUnavailable
        }
        _ = try debts(for: definition.roomID, state: state)
        let impacts = try fairness.calculateDebtImpact(effort: occurrence.effortSnapshot.points,
                                                       executorID: userID, eligibleUserIDs: eligible)
        for i in state.roomMemberships.indices where state.roomMemberships[i].roomID == definition.roomID {
            let updated = state.roomMemberships[i].fairnessDebt + impacts[state.roomMemberships[i].userID, default: 0]
            guard updated.isFinite else { throw DomainError.invalidDistribution }
            state.roomMemberships[i].fairnessDebt = updated
        }
        state.occurrences[index].status = .completed
        state.occurrences[index].completedAt = date
        state.occurrences[index].completedByUserID = userID
        for i in state.assignments.indices where state.assignments[i].occurrenceID == occurrenceID && state.assignments[i].isActive {
            state.assignments[i].endedAt = date
        }
        if definition.kind == .recurring && definition.assignmentPolicy == .afterCompletion {
            // Legacy seed definitions have no queue. Establish it once, preserving the executor's turn.
            if definition.rotationQueue.isEmpty {
                definition.rotationQueue = try members(for: definition, at: nil, state: state)
                guard let current = definition.rotationQueue.firstIndex(of: userID) else { throw DomainError.taskUnavailable }
                definition.currentRotationIndex = try rotation.advance(index: current, queue: definition.rotationQueue)
            }
            try publish(definition: &definition, at: date, dueAt: nil, state: &state)
            state.definitions[definitionIndex] = definition
        }
    }

    /// Extends published schedules without completing, rotating, or editing older occurrences.
    func refresh(houseID: House.ID, at date: Date, state: inout TaskSchedulingState) throws {
        let end = try addingWeeks(12, to: weekStart(date))
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        for i in state.definitions.indices where roomIDs.contains(state.definitions[i].roomID) {
            var definition = state.definitions[i]
            guard definition.kind == .recurring, definition.assignmentPolicy != .afterCompletion,
                  definition.nextScheduledAt != nil else { continue }
            try extend(definition: &definition, through: end, state: &state)
            state.definitions[i] = definition
        }
    }

    /// Membership and all affected queues commit together. Existing occurrences/assignments are untouched.
    func addMember(userID: User.ID, roomID: Room.ID, at date: Date, state: inout TaskSchedulingState) throws {
        guard let room = state.rooms.first(where: { $0.id == roomID }),
              state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else {
            throw DomainError.entityNotFound
        }
        guard !state.roomMemberships.contains(where: { $0.roomID == roomID && $0.userID == userID }) else { return }
        state.roomMemberships.append(RoomMembership(id: UUID(), roomID: roomID, userID: userID))
        // UUID ordering makes the greedy traversal independent of persistence order.
        let indices = state.definitions.indices.filter {
            state.definitions[$0].roomID == roomID && state.definitions[$0].kind == .recurring
                && state.definitions[$0].assignmentPolicy != .selfAssigned
                && state.definitions[$0].visibility == .house
        }.sorted { state.definitions[$0].id.uuidString < state.definitions[$1].id.uuidString }
        let start = try weekStart(date)
        let end = try addingWeeks(12, to: start)
        for i in indices {
            var definition = state.definitions[i]
            if definition.rotationQueue.isEmpty {
                // Unscheduled legacy definitions are initialized when migrated, not guessed here.
                continue
            }
            // Evaluate the first unpublished horizon, not the already committed 12 weeks.
            let forecastStart = try weekStart(max(definition.nextScheduledAt ?? date, date))
            let forecastEnd = try addingWeeks(12, to: forecastStart)
            let dates = definition.assignmentPolicy == .afterCompletion ? [date] : try scheduledDates(
                from: max(definition.nextScheduledAt ?? date, date), definition: definition, end: forecastEnd)
            definition.rotationQueue = try distribution.insertNewMember(
                newUser: userID, currentQueue: definition.rotationQueue,
                currentRotationIndex: definition.currentRotationIndex, taskEffort: definition.effort.points,
                occurrenceWeeks: try dates.map { try weekIndex($0, start: forecastStart) },
                projection: try projectedContinuation(houseID: room.houseID, excluding: definition.id,
                                                      start: forecastStart, state: state),
                debts: debts(for: roomID, state: state)
            )
            state.definitions[i] = definition
        }
        // Fill only missing weeks after all structural changes are evaluated.
        for i in indices where state.definitions[i].nextScheduledAt != nil {
            var definition = state.definitions[i]
            try extend(definition: &definition, through: end, state: &state)
            state.definitions[i] = definition
        }
    }

    private func projectedContinuation(houseID: House.ID, excluding: TaskDefinition.ID, start: Date,
                                       state: TaskSchedulingState) throws -> [User.ID: [ProjectedWeek]] {
        var grid = try projection(houseID: houseID, start: start, state: state)
        let rooms = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        let end = try addingWeeks(12, to: start)
        for definition in state.definitions where rooms.contains(definition.roomID) && definition.id != excluding {
            guard let next = definition.nextScheduledAt, !definition.rotationQueue.isEmpty,
                  definition.rotationQueue.indices.contains(definition.currentRotationIndex) else { continue }
            let dates = try scheduledDates(from: next, definition: definition, end: end)
            for (offset, date) in dates.enumerated() where date >= start {
                let user = definition.rotationQueue[(definition.currentRotationIndex + offset) % definition.rotationQueue.count]
                var weeks = grid[user] ?? Array(repeating: ProjectedWeek(), count: 12)
                weeks[try weekIndex(date, start: start)].add(effort: definition.effort.points)
                grid[user] = weeks
            }
        }
        return grid
    }

    private func extend(definition: inout TaskDefinition, through end: Date, state: inout TaskSchedulingState) throws {
        guard let first = definition.nextScheduledAt else { return }
        let dates = try scheduledDates(from: first, definition: definition, end: end)
        for date in dates {
            let next = try nextDate(after: date, definition: definition)
            try publish(definition: &definition, at: date, dueAt: next, state: &state)
            definition.nextScheduledAt = next
        }
    }

    private func publish(definition: inout TaskDefinition, at date: Date, dueAt: Date?,
                         state: inout TaskSchedulingState) throws {
        guard definition.rotationQueue.indices.contains(definition.currentRotationIndex) else { throw DomainError.invalidDistribution }
        let user = definition.rotationQueue[definition.currentRotationIndex]
        let eligible = try members(for: definition, at: date, state: state)
        // Vacation does not silently change a published static queue. Leave this turn unassigned.
        appendOccurrence(definition: definition, date: date, dueAt: dueAt,
                         userID: eligible.contains(user) ? user : nil, state: &state)
        definition.currentRotationIndex = try rotation.advance(index: definition.currentRotationIndex, queue: definition.rotationQueue)
    }

    private func appendOccurrence(definition: TaskDefinition, date: Date, dueAt: Date?, userID: User.ID?,
                                  state: inout TaskSchedulingState) {
        let occurrence = TaskOccurrence(id: UUID(), taskDefinitionID: definition.id, availableAt: date,
                                        dueAt: dueAt, status: userID == nil ? .available : .assigned,
                                        completedAt: nil, completedByUserID: nil, effortSnapshot: definition.effort)
        state.occurrences.append(occurrence)
        if let userID {
            state.assignments.append(TaskAssignment(id: UUID(), occurrenceID: occurrence.id,
                                                    userID: userID, assignedAt: date, endedAt: nil))
        }
    }

    private func members(for definition: TaskDefinition, at date: Date?, state: TaskSchedulingState) throws -> [User.ID] {
        let houseID = try room(for: definition, state: state).houseID
        let houseMembers = state.houseMemberships.filter { $0.houseID == houseID }
        let houseUsers = Set(houseMembers.map(\.userID))
        let absent: Set<User.ID>
        if let date {
            let absentIDs = Set(state.absences.filter { $0.startsAt <= date && date < $0.endsAt }.map(\.membershipID))
            absent = Set(houseMembers.filter { absentIDs.contains($0.id) }.map(\.userID))
        } else { absent = [] }
        return Set(state.roomMemberships.filter {
            $0.roomID == definition.roomID && houseUsers.contains($0.userID) && !absent.contains($0.userID)
                && (definition.visibility == .house || definition.ownerUserID == $0.userID)
        }.map(\.userID)).sorted { $0.uuidString < $1.uuidString }
    }

    private func debts(for roomID: Room.ID, state: TaskSchedulingState) throws -> [User.ID: Double] {
        var result: [User.ID: Double] = [:]
        for membership in state.roomMemberships where membership.roomID == roomID {
            guard result[membership.userID] == nil, membership.fairnessDebt.isFinite else {
                throw DomainError.invalidDistribution
            }
            result[membership.userID] = membership.fairnessDebt
        }
        return result
    }

    private func room(for definition: TaskDefinition, state: TaskSchedulingState) throws -> Room {
        guard let room = state.rooms.first(where: { $0.id == definition.roomID }) else { throw DomainError.entityNotFound }
        return room
    }

    private func projection(houseID: House.ID, start: Date, state: TaskSchedulingState) throws -> [User.ID: [ProjectedWeek]] {
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        let definitionIDs = Set(state.definitions.filter { roomIDs.contains($0.roomID) }.map(\.id))
        let end = try addingWeeks(12, to: start)
        var owners: [TaskOccurrence.ID: User.ID] = [:]
        for assignment in state.assignments where assignment.isActive {
            guard owners[assignment.occurrenceID] == nil else { throw DomainError.invalidDistribution }
            owners[assignment.occurrenceID] = assignment.userID
        }
        var result: [User.ID: [ProjectedWeek]] = [:]
        for occurrence in state.occurrences where definitionIDs.contains(occurrence.taskDefinitionID)
            && !occurrence.isCompleted && occurrence.availableAt >= start && occurrence.availableAt < end {
            // Completed effort is represented by debt; do not count it twice.
            guard let user = owners[occurrence.id] else { continue }
            guard (1...3).contains(occurrence.effortSnapshot.points) else { throw DomainError.invalidDistribution }
            var weeks = result[user] ?? Array(repeating: ProjectedWeek(), count: 12)
            weeks[try weekIndex(occurrence.availableAt, start: start)].add(effort: occurrence.effortSnapshot.points)
            result[user] = weeks
        }
        return result
    }

    private func nextDate(after date: Date, definition: TaskDefinition) throws -> Date {
        guard case let .recurring(frequency, interval) = definition.recurrence,
              interval > 0 else {
            throw DomainError.invalidSchedule
        }
        switch frequency {
        case .daily:
            return try adding(.day, interval, to: date)
        case .weekly:
            // Weekly scheduling is anchored to the app's Monday-based calendar.
            return try addingWeeks(interval, to: weekStart(date))
        case .monthly:
            return try adding(.month, interval, to: date)
        case .yearly:
            return try adding(.year, interval, to: date)
        }
    }

    private func scheduledDates(from first: Date, definition: TaskDefinition, end: Date) throws -> [Date] {
        var dates: [Date] = []
        var date = first
        while date < end {
            dates.append(date)
            let next = try nextDate(after: date, definition: definition)
            guard next > date else { throw DomainError.invalidSchedule }
            date = next
        }
        return dates
    }

    private func weekStart(_ date: Date) throws -> Date {
        guard let start = calendar.dateInterval(of: .weekOfYear, for: date)?.start else { throw DomainError.invalidDateInterval }
        return start
    }

    private func addingWeeks(_ count: Int, to date: Date) throws -> Date {
        guard let result = calendar.date(byAdding: .weekOfYear, value: count, to: date) else { throw DomainError.invalidDateInterval }
        return result
    }

    private func adding(_ component: Calendar.Component, _ count: Int, to date: Date) throws -> Date {
        guard let result = calendar.date(byAdding: component, value: count, to: date) else {
            throw DomainError.invalidDateInterval
        }
        return result
    }

    private func weekIndex(_ date: Date, start: Date) throws -> Int {
        guard let week = calendar.dateComponents([.weekOfYear], from: start, to: try weekStart(date)).weekOfYear,
              (0..<12).contains(week) else { throw DomainError.invalidDateInterval }
        return week
    }
}
