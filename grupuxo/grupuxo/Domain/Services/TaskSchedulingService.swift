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
        definition.pendingRotation = nil
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
            let participants = try members(for: definition, at: date, state: state, includeAbsent: true)
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
        let houseID = try room(for: definition, state: state).houseID
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        if let boundary = state.roomMemberships.filter({ roomIDs.contains($0.roomID) })
            .flatMap({ $0.rotationChanges ?? [] }).map(\.effectiveAt).filter({ $0 > date }).min() {
            try rebalance(houseID: houseID, boundary: boundary, at: date, state: &state)
        }
        return state.definitions.first { $0.id == definition.id }!
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
        var eligible = try members(for: definition, at: date, state: state, useCurrentMembership: definition.kind == .sporadic)
        let houseID = try room(for: definition, state: state).houseID
        let houseMember = state.houseMemberships.first { $0.houseID == houseID && $0.userID == userID }
        let absent = state.absences.contains { $0.membershipID == houseMember?.id && $0.startsAt <= date && date < $0.endsAt }
        let retained = state.roomMemberships.contains {
            $0.roomID == definition.roomID && $0.userID == userID
                && $0.rotationChanges?.contains(where: { !$0.participates && $0.effectiveAt > occurrence.availableAt }) == true
        }
        guard occurrence.availableAt <= date, houseMember != nil, !absent,
              eligible.contains(userID) || retained,
              state.assignments.contains(where: { $0.occurrenceID == occurrenceID && $0.isActive && $0.userID == userID && $0.assignedAt <= date }) else {
            throw DomainError.taskUnavailable
        }
        if !eligible.contains(userID) { eligible.append(userID) }
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
            activatePending(definition: &definition, at: date)
            // Legacy seed definitions have no queue. Establish it once, preserving the executor's turn.
            if definition.rotationQueue.isEmpty {
                definition.rotationQueue = try members(for: definition, at: date, state: state, includeAbsent: true)
                if let current = definition.rotationQueue.firstIndex(of: userID) {
                    definition.currentRotationIndex = try rotation.advance(index: current, queue: definition.rotationQueue)
                } else { definition.currentRotationIndex = 0 }
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
            if definition.kind == .recurring && definition.assignmentPolicy == .afterCompletion {
                activatePending(definition: &definition, at: date)
                if !definition.rotationQueue.isEmpty,
                   let j = state.occurrences.indices.first(where: { index in
                       let occurrence = state.occurrences[index]
                       return occurrence.taskDefinitionID == definition.id && !occurrence.isCompleted
                           && !state.assignments.contains { $0.occurrenceID == occurrence.id && $0.isActive }
                   }) {
                    guard definition.rotationQueue.indices.contains(definition.currentRotationIndex) else {
                        throw DomainError.invalidDistribution
                    }
                    let user = definition.rotationQueue[definition.currentRotationIndex]
                    if try members(for: definition, at: date, state: state).contains(user) {
                        replaceAssignment(occurrenceIndex: j, userID: user, at: date, state: &state)
                        definition.currentRotationIndex = try rotation.advance(index: definition.currentRotationIndex, queue: definition.rotationQueue)
                    }
                }
                state.definitions[i] = definition
                continue
            }
            guard definition.kind == .recurring, definition.assignmentPolicy != .afterCompletion,
                  definition.nextScheduledAt != nil else { continue }
            try extend(definition: &definition, through: end, state: &state)
            state.definitions[i] = definition
        }
    }

    func addMember(userID: User.ID, roomID: Room.ID, at date: Date, state: inout TaskSchedulingState) throws {
        try changeMember(userID: userID, roomID: roomID, joining: true, at: date, state: &state)
    }

    func removeMember(userID: User.ID, roomID: Room.ID, at date: Date, state: inout TaskSchedulingState) throws {
        try changeMember(userID: userID, roomID: roomID, joining: false, at: date, state: &state)
    }

    private func changeMember(userID: User.ID, roomID: Room.ID, joining: Bool, at date: Date,
                              state: inout TaskSchedulingState) throws {
        guard let room = state.rooms.first(where: { $0.id == roomID }),
              state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else {
            throw DomainError.entityNotFound
        }
        _ = try debts(for: roomID, state: state)
        let existing = state.roomMemberships.firstIndex { $0.roomID == roomID && $0.userID == userID }
        if let existing, state.roomMemberships[existing].isCurrent == joining { return }
        if existing == nil && !joining { return }
        // Materialize the old calendar before changing membership, including missed weeks.
        try refresh(houseID: room.houseID, at: date, state: &state)
        let boundary = try addingWeeks(1, to: weekStart(date))
        let index: Int
        if let existing { index = existing }
        else {
            index = state.roomMemberships.count
            var member = RoomMembership(id: UUID(), roomID: roomID, userID: userID)
            member.rotationChanges = [RotationParticipationChange(effectiveAt: .distantPast, participates: false)]
            state.roomMemberships.append(member)
        }
        state.roomMemberships[index].leftAt = joining ? nil : date
        var changes = state.roomMemberships[index].rotationChanges ?? []
        changes.removeAll { $0.effectiveAt >= boundary }
        changes.append(RotationParticipationChange(effectiveAt: boundary, participates: joining))
        state.roomMemberships[index].rotationChanges = changes
        try rebalance(houseID: room.houseID, boundary: boundary, at: date, state: &state)
    }

    /// Replans existing future executions, retaining their identity and effort snapshot.
    private func rebalance(houseID: House.ID, boundary: Date, at date: Date,
                           state: inout TaskSchedulingState) throws {
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        let end = try addingWeeks(12, to: boundary)
        let indices = state.definitions.indices.filter {
            roomIDs.contains(state.definitions[$0].roomID) && state.definitions[$0].kind == .recurring
                && state.definitions[$0].assignmentPolicy != .selfAssigned
        }.sorted { state.definitions[$0].id.uuidString < state.definitions[$1].id.uuidString }
        var calendarIndices: [Int] = []
        var forecasts: [QueueForecast] = []
        var occurrenceIndices: [[Int]] = []
        for i in indices {
            var definition = state.definitions[i]
            let participants = try members(for: definition, at: boundary, state: state, includeAbsent: true)
            if definition.assignmentPolicy == .afterCompletion {
                activatePending(definition: &definition, at: date)
                let old = try normalizedQueue(definition)
                let queue = old.filter { participants.contains($0) } + participants.filter { !old.contains($0) }
                definition.pendingRotation = PendingRotation(effectiveAt: boundary, queue: queue)
                state.definitions[i] = definition
                continue
            }
            if definition.nextScheduledAt == nil {
                if let last = state.occurrences.filter({ $0.taskDefinitionID == definition.id }).map(\.availableAt).max() {
                    definition.nextScheduledAt = try nextDate(after: last, definition: definition)
                } else { definition.nextScheduledAt = boundary }
                definition.rotationQueue = try members(for: definition, at: date, state: state, includeAbsent: true)
                definition.currentRotationIndex = 0
            }
            try extend(definition: &definition, through: end, state: &state)
            let occurrences = state.occurrences.indices.filter {
                state.occurrences[$0].taskDefinitionID == definition.id && !state.occurrences[$0].isCompleted
                    && state.occurrences[$0].availableAt >= boundary
            }.sorted { state.occurrences[$0].availableAt < state.occurrences[$1].availableAt }
            // Undo the published future turns to recover the phase at the boundary.
            var phase = definition
            if !phase.rotationQueue.isEmpty {
                let n = phase.rotationQueue.count
                phase.currentRotationIndex = (phase.currentRotationIndex - occurrences.count % n + n) % n
            }
            let turns = try occurrences.filter { state.occurrences[$0].availableAt < end }.map { j in
                let occurrence = state.occurrences[j]
                return QueueForecast.Turn(week: try weekIndex(occurrence.availableAt, start: boundary),
                    effort: occurrence.effortSnapshot.points,
                    eligible: Set(try members(for: definition, at: occurrence.availableAt, state: state)),
                    incumbent: state.assignments.first { $0.occurrenceID == occurrence.id && $0.isActive }?.userID)
            }
            forecasts.append(QueueForecast(participants: participants, turns: turns, existingQueue: try normalizedQueue(phase)))
            calendarIndices.append(i)
            occurrenceIndices.append(occurrences)
            state.definitions[i] = definition
        }
        var fixedState = state
        let replanned = Set(calendarIndices.map { state.definitions[$0].id })
        fixedState.occurrences.removeAll { replanned.contains($0.taskDefinitionID) && $0.availableAt >= boundary && !$0.isCompleted }
        let fixed = try projection(houseID: houseID, start: boundary, state: fixedState)
        var houseDebts: [User.ID: Double] = [:]
        for roomID in roomIDs.sorted(by: { $0.uuidString < $1.uuidString }) {
            for (user, value) in try debts(for: roomID, state: state) { houseDebts[user, default: 0] += value }
        }
        let queues = try HouseQueueOptimizer().optimize(forecasts, fixed: fixed, debts: houseDebts)
        for position in calendarIndices.indices {
            let i = calendarIndices[position]
            let queue = queues[position]
            state.definitions[i].rotationQueue = queue
            for (offset, j) in occurrenceIndices[position].enumerated() {
                let occurrence = state.occurrences[j]
                let nominal = queue.isEmpty ? nil : queue[offset % queue.count]
                let eligible = try members(for: state.definitions[i], at: occurrence.availableAt, state: state)
                let owner = nominal.flatMap { eligible.contains($0) ? $0 : nil }
                replaceAssignment(occurrenceIndex: j, userID: owner, at: date, state: &state)
            }
            state.definitions[i].currentRotationIndex = queue.isEmpty ? 0 : occurrenceIndices[position].count % queue.count
        }
    }

    private func normalizedQueue(_ definition: TaskDefinition) throws -> [User.ID] {
        guard !definition.rotationQueue.isEmpty else { return [] }
        guard definition.rotationQueue.indices.contains(definition.currentRotationIndex),
              Set(definition.rotationQueue).count == definition.rotationQueue.count else {
            throw DomainError.invalidDistribution
        }
        let cursor = definition.currentRotationIndex
        return Array(definition.rotationQueue[cursor...] + definition.rotationQueue[..<cursor])
    }

    private func activatePending(definition: inout TaskDefinition, at date: Date) {
        guard let pending = definition.pendingRotation, pending.effectiveAt <= date else { return }
        definition.rotationQueue = pending.queue
        definition.currentRotationIndex = 0
        definition.pendingRotation = nil
    }

    private func replaceAssignment(occurrenceIndex: Int, userID: User.ID?, at date: Date,
                                   state: inout TaskSchedulingState) {
        let occurrence = state.occurrences[occurrenceIndex]
        let active = state.assignments.indices.filter { state.assignments[$0].occurrenceID == occurrence.id && state.assignments[$0].isActive }
        if active.count == 1 && state.assignments[active[0]].userID == userID { return }
        for i in active { state.assignments[i].supersededAt = date }
        if let userID {
            state.assignments.append(TaskAssignment(id: UUID(), occurrenceID: occurrence.id, userID: userID,
                assignedAt: max(date, occurrence.availableAt), endedAt: nil))
        }
        state.occurrences[occurrenceIndex].status = userID == nil ? .available : .assigned
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
        activatePending(definition: &definition, at: date)
        if definition.rotationQueue.isEmpty {
            appendOccurrence(definition: definition, date: date, dueAt: dueAt, userID: nil, state: &state)
            return
        }
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

    private func members(for definition: TaskDefinition, at date: Date?, state: TaskSchedulingState, includeAbsent: Bool = false, useCurrentMembership: Bool = false) throws -> [User.ID] {
        let houseID = try room(for: definition, state: state).houseID
        let houseMembers = state.houseMemberships.filter { $0.houseID == houseID }
        let houseUsers = Set(houseMembers.map(\.userID))
        let absent: Set<User.ID>
        if let date, !includeAbsent {
            let absentIDs = Set(state.absences.filter { $0.startsAt <= date && date < $0.endsAt }.map(\.membershipID))
            absent = Set(houseMembers.filter { absentIDs.contains($0.id) }.map(\.userID))
        } else { absent = [] }
        return Set(state.roomMemberships.filter {
            $0.roomID == definition.roomID && houseUsers.contains($0.userID) && !absent.contains($0.userID)
                && (useCurrentMembership || date == nil ? $0.isCurrent : $0.participates(at: date!))
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
