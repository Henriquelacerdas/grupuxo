import Foundation

/// Value snapshot used by domain transitions, independent of storage technology.
public struct TaskSchedulingState: Sendable {
    public var rooms: [Room]
    public var houseMemberships: [HouseMembership]
    public var roomMemberships: [RoomMembership]
    public var definitions: [TaskDefinition]
    public var occurrences: [TaskOccurrence]
    public var assignments: [TaskAssignment]
    public var absences: [Absence]

    public init(
        rooms: [Room],
        houseMemberships: [HouseMembership],
        roomMemberships: [RoomMembership],
        definitions: [TaskDefinition],
        occurrences: [TaskOccurrence],
        assignments: [TaskAssignment],
        absences: [Absence]
    ) {
        self.rooms = rooms
        self.houseMemberships = houseMemberships
        self.roomMemberships = roomMemberships
        self.definitions = definitions
        self.occurrences = occurrences
        self.assignments = assignments
        self.absences = absences
    }
}

/// Synchronous domain transitions run inside the repository's transaction, never on MainActor.
public struct TaskSchedulingService: Sendable {
    public let distribution: TaskDistributionEngine
    public let fairness: FairnessCalculator
    public let rotation: RotationCalculator
    public let calendar: Calendar

    public init(distribution: TaskDistributionEngine = TaskDistributionEngine(),
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

    public func create(_ input: TaskDefinition, at date: Date, state: inout TaskSchedulingState) throws -> TaskDefinition {
        if let existing = state.definitions.first(where: { $0.id == input.id }) { return existing }
        guard !input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        let target = try room(for: input, state: state)
        try initializeRooms(houseID: target.houseID, at: date, state: &state)
        var definition = input
        definition.endedAt = nil   // uma definição nova nunca nasce encerrada
        let linked = isRoomLinked(definition, state: state)
        if linked { definition.calendarAnchor = try room(for: definition, state: state).calendarAnchor }
        else if case .weekly = definition.recurrence { definition.calendarAnchor = try weekStart(date) }
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
            let firstDate = definition.calendarAnchor != nil && definition.recurrence.weeklyPeriodicity != nil
                ? try firstCreationDate(at: date, definition: definition) : date
            let dates = definition.assignmentPolicy == .afterCompletion
                ? [date] : try scheduledDates(from: firstDate, definition: definition, end: addingWeeks(12, to: start))
            definition.rotationQueue = linked ? [] : try distribution.generateInitialQueue(
                taskEffort: definition.effort.points, participants: participants,
                occurrenceWeeks: try dates.map { try weekIndex($0, start: start) },
                projection: try projection(houseID: room(for: definition, state: state).houseID, start: start, at: date, state: state),
                debts: debts(for: definition.roomID, state: state)
            )
            if definition.assignmentPolicy == .afterCompletion {
                try publish(definition: &definition, at: date, dueAt: nil, state: &state)
            } else {
                definition.nextScheduledAt = firstDate
                if linked {
                    state.definitions.append(definition)
                    // The version must already cover an execution earlier this week, so it gets its owner.
                    try configureRoom(roomID: definition.roomID, boundary: min(firstDate, date), state: &state)
                    state.definitions.removeAll { $0.id == definition.id }
                }
                try fill(definition: &definition, at: date, through: addingWeeks(12, to: start), state: &state)
            }
        }
        state.definitions.append(definition)
        let houseID = try room(for: definition, state: state).houseID
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        if linked { try rebalance(houseID: houseID, boundary: date, at: date, state: &state) }
        if let boundary = state.roomMemberships.filter({ roomIDs.contains($0.roomID) })
            .flatMap({ $0.rotationChanges ?? [] }).map(\.effectiveAt).filter({ $0 > date }).min() {
            try rebalance(houseID: houseID, boundary: boundary, at: date, state: &state)
        }
        return state.definitions.first { $0.id == definition.id }!
    }

    /// Encerra uma tarefa recorrente sem apagar histórico. Quem pede precisa ser morador da casa e
    /// participante atual do cômodo (mesma regra de `create`). Idempotente.
    ///
    /// Mantém a ocorrência já disponível e não concluída: a tarefa só passa à próxima pessoa depois de
    /// concluída, e depois disso nada é publicado (nem a sucessora de `afterCompletion`). Remove só as
    /// ocorrências ainda não disponíveis (`availableAt > date`) e suas atribuições; concluídas,
    /// `fairnessDebt` e atribuições históricas ficam. Não faz `rebalance`: as demais tarefas só
    /// reaproveitam a folga na próxima vez que a escala for replanejada.
    ///
    /// Devolve as ocorrências removidas; trocas pendentes que as citem são tratadas por quem guarda as
    /// trocas (o estado de agendamento não tem trocas).
    @discardableResult
    public func endTask(_ taskID: TaskDefinition.ID, requestedBy userID: User.ID, at date: Date,
                        state: inout TaskSchedulingState) throws -> Set<TaskOccurrence.ID> {
        guard let index = state.definitions.firstIndex(where: { $0.id == taskID }) else {
            throw DomainError.entityNotFound
        }
        let definition = state.definitions[index]
        let room = try room(for: definition, state: state)
        guard definition.kind == .recurring,
              state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }),
              state.roomMemberships.contains(where: { $0.roomID == room.id && $0.userID == userID && $0.isCurrent }) else {
            throw DomainError.taskUnavailable
        }
        if definition.endedAt != nil { return [] }
        let removed = Set(state.occurrences.filter {
            $0.taskDefinitionID == taskID && !$0.isCompleted && $0.availableAt > date
        }.map(\.id))
        state.occurrences.removeAll { removed.contains($0.id) }
        state.assignments.removeAll { removed.contains($0.occurrenceID) }
        state.definitions[index].endedAt = date
        state.definitions[index].nextScheduledAt = nil
        state.definitions[index].pendingRotation = nil
        return removed
    }

    public func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date,
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
        state.occurrences[index].completionDebtImpacts = impacts
        state.occurrences[index].status = .completed
        state.occurrences[index].completedAt = date
        state.occurrences[index].completedByUserID = userID
        for i in state.assignments.indices where state.assignments[i].occurrenceID == occurrenceID && state.assignments[i].isActive {
            state.assignments[i].endedAt = date
        }
        if definition.kind == .recurring && definition.assignmentPolicy == .afterCompletion
            && definition.endedAt == nil && occurrence.didPublishSuccessor != true {
            activatePending(definition: &definition, at: date)
            // Legacy seed definitions have no queue. Establish it once, preserving the executor's turn.
            if definition.rotationQueue.isEmpty {
                definition.rotationQueue = try members(for: definition, at: date, state: state, includeAbsent: true)
                if let current = definition.rotationQueue.firstIndex(of: userID) {
                    definition.currentRotationIndex = try rotation.advance(index: current, queue: definition.rotationQueue)
                } else { definition.currentRotationIndex = 0 }
            }
            try publish(definition: &definition, at: date, dueAt: nil, state: &state)
            state.occurrences[index].didPublishSuccessor = true
            state.definitions[definitionIndex] = definition
        } else if isCalendarScheduled(definition) {
            // The executor has no pending turn left: their next one is published now.
            try fill(definition: &definition, at: date, through: addingWeeks(12, to: weekStart(date)), state: &state)
            state.definitions[definitionIndex] = definition
        }
    }

    public func reopen(occurrenceID: TaskOccurrence.ID, by userID: User.ID,
                state: inout TaskSchedulingState) throws {
        guard let index = state.occurrences.firstIndex(where: { $0.id == occurrenceID }),
              let definition = state.definitions.first(where: { $0.id == state.occurrences[index].taskDefinitionID }) else {
            throw DomainError.entityNotFound
        }
        let occurrence = state.occurrences[index]
        let houseID = try room(for: definition, state: state).houseID
        guard occurrence.isCompleted, occurrence.completedByUserID == userID,
              state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == userID }),
              let assignmentIndex = state.assignments.lastIndex(where: {
                  $0.occurrenceID == occurrenceID && $0.userID == userID
                      && $0.supersededAt == nil && $0.endedAt == occurrence.completedAt
              }) else { throw DomainError.taskUnavailable }
        // Reverse the recorded impact, even if room membership changed since completion.
        for i in state.roomMemberships.indices where state.roomMemberships[i].roomID == definition.roomID {
            state.roomMemberships[i].fairnessDebt -= occurrence.completionDebtImpacts?[state.roomMemberships[i].userID] ?? 0
        }
        state.occurrences[index].status = .assigned
        state.occurrences[index].completedAt = nil
        state.occurrences[index].completedByUserID = nil
        state.occurrences[index].completionDebtImpacts = nil
        state.assignments[assignmentIndex].endedAt = nil
        // Keep already published turns; completing again must not publish another successor.
    }

    /// Publishes the next turn of whoever has no pending one, without completing, rotating, or editing older occurrences.
    public func refresh(houseID: House.ID, at date: Date, state: inout TaskSchedulingState) throws {
        try initializeRooms(houseID: houseID, at: date, state: &state)
        let end = try addingWeeks(12, to: weekStart(date))
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        for i in state.definitions.indices where roomIDs.contains(state.definitions[i].roomID)
            && state.definitions[i].endedAt == nil {
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
            guard isCalendarScheduled(definition) else { continue }
            try fill(definition: &definition, at: date, through: end, state: &state)
            state.definitions[i] = definition
        }
    }

    public func addMember(userID: User.ID, roomID: Room.ID, at date: Date, replan: Bool = true, state: inout TaskSchedulingState) throws {
        try changeMember(userID: userID, roomID: roomID, joining: true, at: date, replan: replan, state: &state)
    }

    public func removeMember(userID: User.ID, roomID: Room.ID, at date: Date, confirmDeletion: Bool = false, houseChange: Bool = false, replan: Bool = true, state: inout TaskSchedulingState) throws {
        try changeMember(userID: userID, roomID: roomID, joining: false, at: date, confirmDeletion: confirmDeletion, houseChange: houseChange, replan: replan, state: &state)
    }

    public func changeMember(userID: User.ID, roomID: Room.ID, joining: Bool, at date: Date, confirmDeletion: Bool = false, houseChange: Bool = false, replan: Bool = true,
                              state: inout TaskSchedulingState) throws {
        guard let room = state.rooms.first(where: { $0.id == roomID }),
              state.houseMemberships.contains(where: { $0.houseID == room.houseID && $0.userID == userID }) else {
            throw DomainError.entityNotFound
        }
        _ = try debts(for: roomID, state: state)
        let existing = state.roomMemberships.firstIndex { $0.roomID == roomID && $0.userID == userID }
        if let existing, state.roomMemberships[existing].isCurrent == joining { return }
        if existing == nil && !joining { return }
        if !joining {
            guard houseChange || !room.representsWholeHouse else { throw DomainError.wholeHouseProtected }
            let count = state.roomMemberships.filter { $0.roomID == roomID && $0.isCurrent }.count
            if count == 1 && !room.representsWholeHouse {
                guard confirmDeletion else { throw DomainError.deletionConfirmationRequired }
                deleteRoom(roomID, state: &state)
                if replan { try rebalance(houseID: room.houseID, boundary: addingWeeks(1, to: weekStart(date)), at: date, state: &state) }
                return
            }
        }
        // Materialize the old calendar before changing membership, including missed weeks.
        try refresh(houseID: room.houseID, at: date, state: &state)
        // Replanning starts next Monday, so this week's assignments keep their owners. A newcomer participates
        // from this week's Monday, so tasks created this week can already go to them; leaving counts next Monday.
        let boundary = try addingWeeks(1, to: weekStart(date))
        let effectiveAt = joining ? try weekStart(date) : boundary
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
        changes.removeAll { $0.effectiveAt >= effectiveAt }
        changes.append(RotationParticipationChange(effectiveAt: effectiveAt, participates: joining))
        state.roomMemberships[index].rotationChanges = changes
        if !joining && !houseChange, let i = state.rooms.firstIndex(where: { $0.id == roomID }) {
            state.rooms[i].visibility = .privateRoom
        }
        if replan { try rebalance(houseID: room.houseID, boundary: boundary, at: date, state: &state) }
    }

    /// Replans the turns from `boundary` on, published or not: the new queues start at the first turn on or after
    /// the boundary, and published future occurrences are redistributed, keeping the ID when their date is published again.
    public func rebalance(houseID: House.ID, boundary: Date, at date: Date,
                           state: inout TaskSchedulingState) throws {
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        let forecastStart = try weekStart(boundary)
        let end = try addingWeeks(12, to: forecastStart)
        let indices = state.definitions.indices.filter {
            roomIDs.contains(state.definitions[$0].roomID) && state.definitions[$0].kind == .recurring
                && state.definitions[$0].assignmentPolicy != .selfAssigned && state.definitions[$0].endedAt == nil
        }.sorted { state.definitions[$0].id.uuidString < state.definitions[$1].id.uuidString }
        var calendarIndices: [Int] = []
        var forecasts: [QueueForecast] = []
        try initializeRooms(houseID: houseID, at: date, state: &state)
        // Previous schedule: current owner of the room's turns not yet published.
        let previous = state
        for id in roomIDs.sorted(by: { $0.uuidString < $1.uuidString }) {
            try configureRoom(roomID: id, boundary: boundary, state: &state)
        }
        for i in indices {
            var definition = state.definitions[i]
            if isRoomLinked(definition, state: state) {
                if definition.nextScheduledAt == nil {
                    definition.calendarAnchor = try room(for: definition, state: state).calendarAnchor
                    definition.nextScheduledAt = try firstWeeklyDate(onOrAfter: boundary, definition: definition)
                }
                try fill(definition: &definition, at: date, through: end, state: &state)
                definition.rotationQueue = []
                state.definitions[i] = definition
                continue
            }
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
            try fill(definition: &definition, at: date, through: end, state: &state)
            // There is a single pending queue change: the previous one, from a boundary already passed, applies now.
            if let pending = definition.pendingRotation, pending.effectiveAt < boundary {
                try advance(definition: &definition, to: pending.effectiveAt, through: end, state: state)
            }
            let (all, rest) = try turns(of: definition, through: end, state: state)
            let published = publishedByDate(definition.id, state: state)
            let turns = all.filter { $0.at >= boundary && published[$0.at]?.isCompleted != true }
            let phase = turns.first?.cursor ?? rest
            var phased = definition
            phased.rotationQueue = phase.queue
            phased.currentRotationIndex = phase.index
            forecasts.append(QueueForecast(participants: participants, turns: try turns.map {
                try forecastTurn(definition, $0, published: published, start: forecastStart, slot: nil, previous: nil, state: state)
            }, existingQueue: try normalizedQueue(phased)))
            calendarIndices.append(i)
            state.definitions[i] = definition
        }
        let independentCount = forecasts.count
        let groupedRooms = state.rooms.indices.filter { roomIDs.contains(state.rooms[$0].id) }
            .sorted { state.rooms[$0].id.uuidString < state.rooms[$1].id.uuidString }
        for ri in groupedRooms {
            let room = state.rooms[ri]
            guard let version = room.scheduleVersions.last(where: { $0.effectiveAt <= boundary }) else { throw DomainError.invalidSchedule }
            let linked = state.definitions.filter { $0.roomID == room.id && isRoomLinked($0, state: state) }
            let ids = Set(linked.map(\.id))
            var entries: [(definition: TaskDefinition, turn: ScheduleTurn, published: [Date: TaskOccurrence])] = []
            for definition in linked {
                let published = publishedByDate(definition.id, state: state)
                for turn in try turns(of: definition, through: end, state: state).turns
                where turn.at >= boundary && published[turn.at]?.isCompleted != true {
                    entries.append((definition, turn, published))
                }
            }
            entries.sort {
                $0.turn.at == $1.turn.at ? $0.definition.id.uuidString < $1.definition.id.uuidString : $0.turn.at < $1.turn.at
            }
            let turns = try entries.map {
                try forecastTurn($0.definition, $0.turn, published: $0.published, start: forecastStart,
                    slot: try roomSlot(room: room, version: version, taskID: $0.definition.id, date: $0.turn.at),
                    previous: previous, state: state)
            }
            let period = try periodIndex(room: room, date: boundary)
            let periodStart = try addingWeeks(period * room.periodicity.intervalWeeks, to: room.calendarAnchor!)
            let preserveCurrent = boundary == date && state.occurrences.contains {
                ids.contains($0.taskDefinitionID) && $0.availableAt >= periodStart && $0.availableAt < boundary
            }
            forecasts.append(QueueForecast(participants: version.queue, turns: turns, isFixed: preserveCurrent, existingQueue: version.queue))
        }
        let replanned = Set(indices.filter { state.definitions[$0].assignmentPolicy != .afterCompletion }.map { state.definitions[$0].id })
        let fixed = try projection(houseID: houseID, start: forecastStart, at: date, state: state,
                                   excluding: ProjectionExclusion(definitions: replanned, from: boundary))
        var houseDebts: [User.ID: Double] = [:]
        for roomID in roomIDs.sorted(by: { $0.uuidString < $1.uuidString }) {
            for (user, value) in try debts(for: roomID, state: state) { houseDebts[user, default: 0] += value }
        }
        let queues = try HouseQueueOptimizer().optimize(forecasts, fixed: fixed, debts: houseDebts)
        for (position, i) in calendarIndices.enumerated() {
            var definition = state.definitions[i]
            definition.pendingRotation = PendingRotation(effectiveAt: boundary, queue: queues[position])
            try fill(definition: &definition, at: date, through: end, state: &state,
                     replaceable: replaceable(of: definition.id, from: boundary, at: date, state: state))
            state.definitions[i] = definition
        }
        for (offset, ri) in groupedRooms.enumerated() {
            let queue = queues[independentCount + offset]
            let vi = state.rooms[ri].scheduleVersions.lastIndex { $0.effectiveAt <= boundary }!
            state.rooms[ri].scheduleVersions[vi].queue = queue
            let roomID = state.rooms[ri].id
            let linked = state.definitions.indices.filter {
                state.definitions[$0].roomID == roomID && isRoomLinked(state.definitions[$0], state: state)
            }.sorted { state.definitions[$0].id.uuidString < state.definitions[$1].id.uuidString }
            for i in linked {
                var definition = state.definitions[i]
                try fill(definition: &definition, at: date, through: end, state: &state,
                         replaceable: replaceable(of: definition.id, from: boundary, at: date, state: state))
                state.definitions[i] = definition
            }
        }
    }

    private func forecastTurn(_ definition: TaskDefinition, _ turn: ScheduleTurn, published: [Date: TaskOccurrence],
                              start: Date, slot: Int?, previous: TaskSchedulingState?,
                              state: TaskSchedulingState) throws -> QueueForecast.Turn {
        let occurrence = published[turn.at]
        let incumbent: User.ID?
        if let occurrence {
            incumbent = state.assignments.first { $0.occurrenceID == occurrence.id && $0.isActive }?.userID
        } else if let previous {
            incumbent = try roomOwner(definition: definition, date: turn.at, state: previous)
        } else { incumbent = turn.owner }
        return QueueForecast.Turn(week: try weekIndex(turn.at, start: start),
            effort: occurrence?.effortSnapshot.points ?? definition.effort.points,
            eligible: Set(try members(for: definition, at: turn.at, state: state)),
            incumbent: incumbent, slot: slot)
    }

    public func normalizedQueue(_ definition: TaskDefinition) throws -> [User.ID] {
        guard !definition.rotationQueue.isEmpty else { return [] }
        guard definition.rotationQueue.indices.contains(definition.currentRotationIndex),
              Set(definition.rotationQueue).count == definition.rotationQueue.count else {
            throw DomainError.invalidDistribution
        }
        let cursor = definition.currentRotationIndex
        return Array(definition.rotationQueue[cursor...] + definition.rotationQueue[..<cursor])
    }

    public func activatePending(definition: inout TaskDefinition, at date: Date) {
        guard let pending = definition.pendingRotation, pending.effectiveAt <= date else { return }
        definition.rotationQueue = pending.queue
        definition.currentRotationIndex = 0
        definition.pendingRotation = nil
    }

    public func replaceAssignment(occurrenceIndex: Int, userID: User.ID?, at date: Date,
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

    public func publish(definition: inout TaskDefinition, at date: Date, dueAt: Date?,
                         state: inout TaskSchedulingState) throws {
        if isRoomLinked(definition, state: state) {
            appendOccurrence(definition: definition, date: date, dueAt: dueAt,
                userID: try roomOwner(definition: definition, date: date, state: state), state: &state)
            return
        }
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

    public func appendOccurrence(definition: TaskDefinition, date: Date, dueAt: Date?, userID: User.ID?,
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

    public func members(for definition: TaskDefinition, at date: Date?, state: TaskSchedulingState, includeAbsent: Bool = false, useCurrentMembership: Bool = false) throws -> [User.ID] {
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
        }.map(\.userID)).sorted { $0.uuidString < $1.uuidString }
    }

    public func debts(for roomID: Room.ID, state: TaskSchedulingState) throws -> [User.ID: Double] {
        var result: [User.ID: Double] = [:]
        for membership in state.roomMemberships where membership.roomID == roomID {
            guard result[membership.userID] == nil, membership.fairnessDebt.isFinite else {
                throw DomainError.invalidDistribution
            }
            result[membership.userID] = membership.fairnessDebt
        }
        return result
    }

    public func room(for definition: TaskDefinition, state: TaskSchedulingState) throws -> Room {
        guard let room = state.rooms.first(where: { $0.id == definition.roomID }) else { throw DomainError.entityNotFound }
        return room
    }

    /// Pending load per resident and week in `[start, start + 12 weeks)`: published occurrences with an owner and
    /// calendar turns not yet published with an owner and due after `date` (effort comes from the definition).
    public func projection(houseID: House.ID, start: Date, at date: Date, state: TaskSchedulingState,
                           excluding: ProjectionExclusion? = nil) throws -> [User.ID: [ProjectedWeek]] {
        let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
        let definitions = state.definitions.filter { roomIDs.contains($0.roomID) }
        let definitionIDs = Set(definitions.map(\.id))
        let end = try addingWeeks(12, to: start)
        var owners: [TaskOccurrence.ID: User.ID] = [:]
        for assignment in state.assignments where assignment.isActive {
            guard owners[assignment.occurrenceID] == nil else { throw DomainError.invalidDistribution }
            owners[assignment.occurrenceID] = assignment.userID
        }
        func isExcluded(_ taskID: TaskDefinition.ID, _ date: Date) -> Bool {
            excluding.map { $0.definitions.contains(taskID) && date >= $0.from } ?? false
        }
        var result: [User.ID: [ProjectedWeek]] = [:]
        func add(_ user: User.ID, _ date: Date, _ points: Int) throws {
            guard (1...3).contains(points) else { throw DomainError.invalidDistribution }
            var weeks = result[user] ?? Array(repeating: ProjectedWeek(), count: 12)
            weeks[try weekIndex(date, start: start)].add(effort: points)
            result[user] = weeks
        }
        for occurrence in state.occurrences where definitionIDs.contains(occurrence.taskDefinitionID)
            && !occurrence.isCompleted && occurrence.availableAt >= start && occurrence.availableAt < end
            && !isExcluded(occurrence.taskDefinitionID, occurrence.availableAt) {
            // Completed effort is represented by debt; do not count it twice.
            guard let user = owners[occurrence.id] else { continue }
            try add(user, occurrence.availableAt, occurrence.effortSnapshot.points)
        }
        for definition in definitions where try isCalendarScheduled(definition) && legacyStart(of: definition, at: date, state: state) == nil {
            let published = Set(state.occurrences.filter { $0.taskDefinitionID == definition.id }.map(\.availableAt))
            for turn in try turns(of: definition, through: end, state: state).turns {
                guard let owner = turn.owner, turn.at >= start, turn.dueAt > date, !published.contains(turn.at),
                      !isExcluded(definition.id, turn.at) else { continue }
                try add(owner, turn.at, definition.effort.points)
            }
        }
        return result
    }

    public func suggestedResident(roomID: Room.ID, at date: Date, state: TaskSchedulingState) throws -> User.ID? {
        guard let room = state.rooms.first(where: { $0.id == roomID }) else { throw DomainError.entityNotFound }
        let houseMembers = Set(state.houseMemberships.filter { $0.houseID == room.houseID }.map(\.userID))
        let candidates = Set(state.roomMemberships.filter {
            $0.roomID == roomID && $0.isCurrent && houseMembers.contains($0.userID)
        }.map(\.userID))
        guard !candidates.isEmpty else { return nil }

        let weeklyLoads = try projection(houseID: room.houseID, start: weekStart(date), at: date, state: state)
        return candidates.min { left, right in
            let leftLoad = weeklyLoads[left]?.first?.load ?? 0
            let rightLoad = weeklyLoads[right]?.first?.load ?? 0
            if leftLoad != rightLoad { return leftLoad < rightLoad }
            return left.uuidString < right.uuidString
        }
    }

    public func nextDate(after date: Date, definition: TaskDefinition) throws -> Date {
        if definition.calendarAnchor != nil && definition.recurrence.weeklyPeriodicity != nil {
            return try firstWeeklyDate(onOrAfter: adding(.day, 1, to: calendar.startOfDay(for: date)), definition: definition)
        }
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

    public func scheduledDates(from first: Date, definition: TaskDefinition, end: Date) throws -> [Date] {
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

    public func weekStart(_ date: Date) throws -> Date {
        guard let start = calendar.dateInterval(of: .weekOfYear, for: date)?.start else { throw DomainError.invalidDateInterval }
        return start
    }

    public func addingWeeks(_ count: Int, to date: Date) throws -> Date {
        guard let result = calendar.date(byAdding: .weekOfYear, value: count, to: date) else { throw DomainError.invalidDateInterval }
        return result
    }

    public func adding(_ component: Calendar.Component, _ count: Int, to date: Date) throws -> Date {
        guard let result = calendar.date(byAdding: component, value: count, to: date) else {
            throw DomainError.invalidDateInterval
        }
        return result
    }

    public func weekIndex(_ date: Date, start: Date) throws -> Int {
        guard let week = calendar.dateComponents([.weekOfYear], from: start, to: try weekStart(date)).weekOfYear,
              (0..<12).contains(week) else { throw DomainError.invalidDateInterval }
        return week
    }
}
