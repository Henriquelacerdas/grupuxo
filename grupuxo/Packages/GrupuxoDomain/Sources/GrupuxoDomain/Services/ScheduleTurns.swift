import Foundation

/// Calendar schedule cursor of a definition (`nextScheduledAt`, queue, position and pending queue change).
public struct TurnCursor: Hashable, Sendable {
    public let at: Date
    public let queue: [User.ID]
    public let index: Int
    public let pending: PendingRotation?

    public init(at: Date, queue: [User.ID], index: Int, pending: PendingRotation?) {
        self.at = at
        self.queue = queue
        self.index = index
        self.pending = pending
    }
}

/// A calendar turn, published or not. `owner` is nil without a queue, during an absence or without participation.
public struct ScheduleTurn: Hashable, Sendable {
    public let at: Date
    public let dueAt: Date
    public let owner: User.ID?
    /// The cursor stopped at this turn (with the pending queue change already applied, if it holds here).
    public let cursor: TurnCursor

    public init(at: Date, dueAt: Date, owner: User.ID?, cursor: TurnCursor) {
        self.at = at
        self.dueAt = dueAt
        self.owner = owner
        self.cursor = cursor
    }
}

/// Projection without the turns of `definitions` from `from` on (what the replanning will redistribute).
public struct ProjectionExclusion: Sendable {
    public let definitions: Set<TaskDefinition.ID>
    public let from: Date

    public init(definitions: Set<TaskDefinition.ID>, from: Date) {
        self.definitions = definitions
        self.from = from
    }
}

extension TaskSchedulingService {
    /// Calendar recurring task (not after completion), active and with a cursor: its turns come from `turns`.
    public func isCalendarScheduled(_ definition: TaskDefinition) -> Bool {
        definition.kind == .recurring && definition.assignmentPolicy != .afterCompletion
            && definition.endedAt == nil && definition.nextScheduledAt != nil
    }

    /// Turns from the cursor on, before `end`, without changing anything. The queue advances one position per turn,
    /// including turns without an owner (absence); the pending queue change holds from the first turn on or after it.
    public func turns(of definition: TaskDefinition, through end: Date,
                      state: TaskSchedulingState) throws -> (turns: [ScheduleTurn], rest: TurnCursor) {
        guard let first = definition.nextScheduledAt else { throw DomainError.invalidSchedule }
        let linked = isRoomLinked(definition, state: state)
        var turns: [ScheduleTurn] = []
        var date = first
        var queue = definition.rotationQueue
        var index = definition.currentRotationIndex
        var pending = definition.pendingRotation
        while date < end {
            var owner: User.ID?
            if linked {
                owner = try roomOwner(definition: definition, date: date, state: state)
            } else {
                if let change = pending, change.effectiveAt <= date {
                    queue = change.queue
                    index = 0
                    pending = nil
                }
                if !queue.isEmpty {
                    guard queue.indices.contains(index) else { throw DomainError.invalidDistribution }
                    // Vacation does not silently change a static queue: the turn has no owner.
                    if try members(for: definition, at: date, state: state).contains(queue[index]) { owner = queue[index] }
                }
            }
            let dueAt = try nextDate(after: date, definition: definition)
            guard dueAt > date else { throw DomainError.invalidSchedule }
            turns.append(ScheduleTurn(at: date, dueAt: dueAt, owner: owner,
                                      cursor: TurnCursor(at: date, queue: queue, index: index, pending: pending)))
            if !linked && !queue.isEmpty { index = try rotation.advance(index: index, queue: queue) }
            date = dueAt
        }
        return (turns, TurnCursor(at: date, queue: queue, index: index, pending: pending))
    }

    /// What `fill` would publish and where the cursor would stop. Each resident has at most one pending turn: their
    /// next turn is only published when they have none. In the room schedule an overdue pending turn does not count
    /// (the next one is published); in tasks with their own periodicity it counts until completed, and their turns
    /// that expired meanwhile are skipped. The cursor only passes turns already available and settled (published,
    /// without an owner, or expired).
    public func plan(for definition: TaskDefinition, at date: Date, through end: Date, state: TaskSchedulingState,
                     replaceable: Set<TaskOccurrence.ID> = []) throws -> (publish: [ScheduleTurn], cursor: TurnCursor) {
        let linked = isRoomLinked(definition, state: state)
        let (turns, rest) = try self.turns(of: definition, through: end, state: state)
        let own = state.occurrences.filter { $0.taskDefinitionID == definition.id && !replaceable.contains($0.id) }
        var published = Set(own.map(\.availableAt))
        let open = Set(own.filter { occurrence in
            !occurrence.isCompleted && !(linked && occurrence.dueAt.map { $0 <= date } == true)
        }.map(\.id))
        var satisfied = Set(state.assignments.filter { open.contains($0.occurrenceID) && $0.isActive }.map(\.userID))
        var publish: [ScheduleTurn] = []
        for turn in turns {
            guard let owner = turn.owner, !published.contains(turn.at), !satisfied.contains(owner) else { continue }
            let overdue = turn.dueAt <= date
            if overdue && !linked { continue }
            publish.append(turn)
            published.insert(turn.at)
            if !overdue { satisfied.insert(owner) }
        }
        let settled = turns.prefix {
            $0.at <= date && (published.contains($0.at) || $0.owner == nil || $0.dueAt <= date)
        }.count
        return (publish, settled < turns.count ? turns[settled].cursor : rest)
    }

    /// Publishes the next turn of each resident without a pending one (see `plan`) and advances the cursor.
    /// Occurrences in `replaceable` count as unpublished: they are reused (same ID) if their date is published
    /// again and removed otherwise.
    public func fill(definition: inout TaskDefinition, at date: Date, through end: Date,
                     state: inout TaskSchedulingState, replaceable: Set<TaskOccurrence.ID> = []) throws {
        guard definition.endedAt == nil, definition.nextScheduledAt != nil else { return }
        var replaceable = replaceable
        try rewindLegacy(definition: &definition, at: date, state: state, replaceable: &replaceable)
        let plan = try self.plan(for: definition, at: date, through: end, state: state, replaceable: replaceable)
        for turn in plan.publish {
            if let j = state.occurrences.firstIndex(where: {
                replaceable.contains($0.id) && $0.taskDefinitionID == definition.id && $0.availableAt == turn.at
            }) {
                replaceable.remove(state.occurrences[j].id)
                replaceAssignment(occurrenceIndex: j, userID: turn.owner, at: date, state: &state)
            } else {
                appendOccurrence(definition: definition, date: turn.at, dueAt: turn.dueAt, userID: turn.owner, state: &state)
            }
        }
        moveCursor(definition: &definition, to: plan.cursor)
        let removed = Set(state.occurrences.filter {
            replaceable.contains($0.id) && $0.taskDefinitionID == definition.id
        }.map(\.id))
        guard !removed.isEmpty else { return }
        state.occurrences.removeAll { removed.contains($0.id) }
        state.assignments.removeAll { removed.contains($0.occurrenceID) }
    }

    /// Moves the cursor to the first turn on or after `effectiveAt`, applying the pending queue change.
    public func advance(definition: inout TaskDefinition, to effectiveAt: Date, through end: Date,
                        state: TaskSchedulingState) throws {
        let (turns, rest) = try self.turns(of: definition, through: end, state: state)
        let cursor = turns.first { $0.at >= effectiveAt }?.cursor ?? rest
        moveCursor(definition: &definition, to: cursor)
        activatePending(definition: &definition, at: cursor.at)
    }

    public func moveCursor(definition: inout TaskDefinition, to cursor: TurnCursor) {
        definition.nextScheduledAt = cursor.at
        definition.rotationQueue = cursor.queue
        definition.currentRotationIndex = cursor.index
        definition.pendingRotation = cursor.pending
    }

    /// Schedule saved before per-resident publication: every turn up to 12 weeks published, one occurrence per turn
    /// (including those without an owner), and the cursor after them. Returns the first turn not yet available and
    /// how many turns there are from it to the cursor; `nil` for the current schedule (where the cursor never passes
    /// a turn not yet available).
    public func legacyStart(of definition: TaskDefinition, at date: Date,
                            state: TaskSchedulingState) throws -> (start: Date, turns: Int)? {
        guard let next = definition.nextScheduledAt else { return nil }
        let own = state.occurrences.filter { $0.taskDefinitionID == definition.id }
        let published = Set(own.map(\.availableAt))
        guard let start = own.filter({ !$0.isCompleted && $0.availableAt > date && $0.availableAt < next })
            .map(\.availableAt).min() else { return nil }
        var turns = 0
        var current = start
        while current < next {
            guard published.contains(current) else { return nil }
            turns += 1
            let following = try nextDate(after: current, definition: definition)
            guard following > current else { throw DomainError.invalidSchedule }
            current = following
        }
        return current == next ? (start, turns) : nil
    }

    /// Moves the cursor of an old schedule (`legacyStart`) back to the first turn not yet available.
    public func rewindLegacy(definition: inout TaskDefinition, at date: Date, state: TaskSchedulingState,
                             replaceable: inout Set<TaskOccurrence.ID>) throws {
        guard let legacy = try legacyStart(of: definition, at: date, state: state) else { return }
        let n = definition.rotationQueue.count
        if n > 0 { definition.currentRotationIndex = ((definition.currentRotationIndex - legacy.turns) % n + n) % n }
        definition.nextScheduledAt = legacy.start
        for occurrence in state.occurrences
        where occurrence.taskDefinitionID == definition.id && !occurrence.isCompleted && occurrence.availableAt >= legacy.start {
            replaceable.insert(occurrence.id)
        }
    }

    /// Future occurrences (not yet available and from the boundary on) that the replanning may redistribute.
    public func replaceable(of taskID: TaskDefinition.ID, from boundary: Date, at date: Date,
                            state: TaskSchedulingState) -> Set<TaskOccurrence.ID> {
        Set(state.occurrences.filter {
            $0.taskDefinitionID == taskID && !$0.isCompleted && $0.availableAt >= boundary && $0.availableAt > date
        }.map(\.id))
    }

    public func publishedByDate(_ taskID: TaskDefinition.ID, state: TaskSchedulingState) -> [Date: TaskOccurrence] {
        var result: [Date: TaskOccurrence] = [:]
        for occurrence in state.occurrences where occurrence.taskDefinitionID == taskID { result[occurrence.availableAt] = occurrence }
        return result
    }
}
