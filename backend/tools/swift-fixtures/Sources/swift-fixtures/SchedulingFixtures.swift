import Foundation
import GrupuxoDomain

// MARK: - Codificação do estado no formato do TypeScript (datas ISO, IDs minúsculos, nulos explícitos)

func d(_ date: Date?) -> Any {
    guard let date else { return NSNull() }
    if date == .distantPast { return "distantPast" }
    if date == .distantFuture { return "distantFuture" }
    return iso(date)
}

func opt<T>(_ value: T?, _ transform: (T) -> Any) -> Any { value.map(transform) ?? NSNull() }

func enc(_ r: RecurrencePolicy) -> [String: Any] {
    switch r {
    case .none: ["kind": "none"]
    case let .recurring(frequency, interval): ["kind": "recurring", "frequency": frequency.rawValue, "interval": interval]
    case let .weekly(p): ["kind": "weekly", "periodicity": enc(p)]
    }
}
func enc(_ p: WeeklyPeriodicity) -> [String: Any] { ["executionsPerPeriod": p.executionsPerPeriod, "intervalWeeks": p.intervalWeeks] }

func enc(_ room: Room) -> [String: Any] {
    [
        "id": id(room.id), "houseID": id(room.houseID), "name": room.name, "kind": room.kind.rawValue,
        "category": room.category.rawValue, "visibility": room.visibility.rawValue, "periodicity": enc(room.periodicity),
        "responsibleCount": room.responsibleCount, "calendarAnchor": d(room.calendarAnchor),
        "scheduleVersions": room.scheduleVersions.map { v -> [String: Any] in
            ["effectiveAt": d(v.effectiveAt), "queue": ids(v.queue), "responsibleCount": v.responsibleCount,
             "taskRoles": Dictionary(uniqueKeysWithValues: v.taskRoles.map { (id($0.key), $0.value) }), "periodIndex": v.periodIndex]
        },
        "icon": room.icon, "color": room.color.rawValue,
    ]
}

func enc(_ m: RoomMembership) -> [String: Any] {
    ["id": id(m.id), "roomID": id(m.roomID), "userID": id(m.userID), "fairnessDebt": num(m.fairnessDebt), "leftAt": d(m.leftAt),
     "rotationChanges": opt(m.rotationChanges) { $0.map { ["effectiveAt": d($0.effectiveAt), "participates": $0.participates] as [String: Any] } }]
}

func enc(_ t: TaskDefinition) -> [String: Any] {
    [
        "id": id(t.id), "roomID": id(t.roomID), "name": t.name, "details": t.details, "effort": ["points": t.effort.points],
        "kind": t.kind.rawValue, "recurrence": enc(t.recurrence), "assignmentPolicy": t.assignmentPolicy.rawValue,
        "sourceSuggestionID": opt(t.sourceSuggestionID) { $0 }, "rotationQueue": ids(t.rotationQueue),
        "currentRotationIndex": t.currentRotationIndex, "nextScheduledAt": d(t.nextScheduledAt),
        "pendingRotation": opt(t.pendingRotation) { ["effectiveAt": d($0.effectiveAt), "queue": ids($0.queue)] as [String: Any] },
        "calendarAnchor": d(t.calendarAnchor),
    ]
}

func enc(_ o: TaskOccurrence) -> [String: Any] {
    [
        "id": id(o.id), "taskDefinitionID": id(o.taskDefinitionID), "availableAt": d(o.availableAt), "dueAt": d(o.dueAt),
        "status": o.status.rawValue, "completedAt": d(o.completedAt), "completedByUserID": opt(o.completedByUserID) { id($0) },
        "completionDebtImpacts": opt(o.completionDebtImpacts) { Dictionary(uniqueKeysWithValues: $0.map { (id($0.key), num($0.value)) }) },
        "didPublishSuccessor": opt(o.didPublishSuccessor) { $0 }, "effortSnapshot": ["points": o.effortSnapshot.points],
    ]
}

func enc(_ a: TaskAssignment) -> [String: Any] {
    ["id": id(a.id), "occurrenceID": id(a.occurrenceID), "userID": id(a.userID), "assignedAt": d(a.assignedAt),
     "endedAt": d(a.endedAt), "supersededAt": d(a.supersededAt)]
}

func enc(_ a: Absence) -> [String: Any] {
    ["id": id(a.id), "membershipID": id(a.membershipID), "startsAt": d(a.startsAt), "endsAt": d(a.endsAt), "reason": opt(a.reason) { $0 }]
}

func enc(_ s: TaskSchedulingState) -> [String: Any] {
    [
        "rooms": s.rooms.map(enc),
        "houseMemberships": s.houseMemberships.map { ["id": id($0.id), "houseID": id($0.houseID), "userID": id($0.userID)] as [String: Any] },
        "roomMemberships": s.roomMemberships.map(enc), "definitions": s.definitions.map(enc),
        "occurrences": s.occurrences.map(enc), "assignments": s.assignments.map(enc), "absences": s.absences.map(enc),
    ]
}

// MARK: - IDs novos (gerados com UUID() aleatório pelo Swift) viram new-1, new-2... por ordem de aparição

private let uuidPattern = try! NSRegularExpression(pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

func knownIDs(in object: Any) -> Set<String> {
    let text = compactJSON(object)
    let range = NSRange(text.startIndex..., in: text)
    return Set(uuidPattern.matches(in: text, range: range).map { String(text[Range($0.range, in: text)!]).lowercased() })
}

func normalizeNewIDs(_ value: Any, known: Set<String>, map: inout [String: String]) -> Any {
    if let text = value as? String {
        let lower = text.lowercased()
        let isUUID = uuidPattern.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower))?.range.length == lower.utf16.count
        guard isUUID, !known.contains(lower) else { return text }
        if let mapped = map[lower] { return mapped }
        let mapped = "new-\(map.count + 1)"
        map[lower] = mapped
        return mapped
    }
    if let array = value as? [Any] { return array.map { normalizeNewIDs($0, known: known, map: &map) } }
    if let dict = value as? [String: Any] {
        var result: [String: Any] = [:]
        for key in dict.keys.sorted() { result[key] = normalizeNewIDs(dict[key]!, known: known, map: &map) }
        return result
    }
    return value
}

// MARK: - Cenários

struct Ref { let def: UUID; let n: Int }
enum Who { case user(UUID), assigneeOf(Ref) }

enum Step {
    case create(TaskDefinition, at: Date)
    case complete(Ref, by: Who, at: Date)
    case reopen(Ref, by: Who)
    case refresh(at: Date)
    case addMember(UUID, room: UUID, at: Date, replan: Bool = true)
    case removeMember(UUID, room: UUID, at: Date, confirmDeletion: Bool = false, houseChange: Bool = false, replan: Bool = true)
    case rebalance(boundary: Date, at: Date)
    case addAbsence(Absence)
    case suggestedResident(room: UUID, at: Date)
}

func enc(_ ref: Ref) -> [String: Any] { ["def": id(ref.def), "n": ref.n] }
func enc(_ who: Who) -> [String: Any] {
    switch who {
    case let .user(u): ["user": id(u)]
    case let .assigneeOf(r): ["assigneeOf": enc(r)]
    }
}

func enc(_ step: Step, house: UUID) -> [String: Any] {
    switch step {
    case let .create(def, at): ["op": "create", "definition": enc(def), "at": d(at)]
    case let .complete(ref, who, at): ["op": "complete", "ref": enc(ref), "by": enc(who), "at": d(at)]
    case let .reopen(ref, who): ["op": "reopen", "ref": enc(ref), "by": enc(who)]
    case let .refresh(at): ["op": "refresh", "houseID": id(house), "at": d(at)]
    case let .addMember(user, room, at, replan): ["op": "addMember", "userID": id(user), "roomID": id(room), "at": d(at), "replan": replan]
    case let .removeMember(user, room, at, confirm, houseChange, replan):
        ["op": "removeMember", "userID": id(user), "roomID": id(room), "at": d(at), "confirmDeletion": confirm, "houseChange": houseChange, "replan": replan]
    case let .rebalance(boundary, at): ["op": "rebalance", "houseID": id(house), "boundary": d(boundary), "at": d(at)]
    case let .addAbsence(a): ["op": "addAbsence", "absence": enc(a)]
    case let .suggestedResident(room, at): ["op": "suggestedResident", "roomID": id(room), "at": d(at)]
    }
}

struct Scenario {
    let name: String
    let zone: String
    var state: TaskSchedulingState
    var steps: [Step]
}

enum W {
    static let house = uid(1000)
    static func user(_ n: Int) -> UUID { uid(n) }
    static let whole = uid(100), kitchen = uid(101), bathroom = uid(102), office = uid(103)
    static func def(_ n: Int) -> UUID { uid(400 + n) }
}

func room(_ id: UUID, _ name: String, kind: RoomKind = .standard, visibility: RoomVisibility = .common,
          periodicity: WeeklyPeriodicity = WeeklyPeriodicity(), responsible: Int = 1) -> Room {
    Room(id: id, houseID: W.house, name: name, kind: kind, visibility: visibility, periodicity: periodicity, responsibleCount: responsible)
}

/// Casa com `userCount` moradores; cômodos comuns com todos, `office` privado só com os dois primeiros.
func world(users userCount: Int = 4, kitchen: WeeklyPeriodicity = WeeklyPeriodicity(executionsPerPeriod: 2),
           kitchenMembers: Int? = nil, responsible: Int = 1) -> TaskSchedulingState {
    let users = (1...userCount).map(W.user)
    var roomMemberships: [RoomMembership] = []
    var counter = 0
    func member(_ room: UUID, _ user: UUID) {
        counter += 1
        roomMemberships.append(RoomMembership(id: uid(200 + counter), roomID: room, userID: user))
    }
    for u in users { member(W.whole, u) }
    for u in users.prefix(kitchenMembers ?? userCount) { member(W.kitchen, u) }
    for u in users { member(W.bathroom, u) }
    for u in users.prefix(2) { member(W.office, u) }
    return TaskSchedulingState(
        rooms: [
            room(W.whole, "Casa toda", kind: .wholeHouse, periodicity: WeeklyPeriodicity(executionsPerPeriod: 2)),
            room(W.kitchen, "Cozinha", periodicity: kitchen, responsible: responsible),
            room(W.bathroom, "Banheiro", periodicity: WeeklyPeriodicity(executionsPerPeriod: 2)),
            room(W.office, "Escritório", visibility: .privateRoom, periodicity: WeeklyPeriodicity(executionsPerPeriod: 2)),
        ],
        houseMemberships: users.enumerated().map { HouseMembership(id: uid(300 + $0.offset + 1), houseID: W.house, userID: $0.element) },
        roomMemberships: roomMemberships, definitions: [], occurrences: [], assignments: [], absences: [])
}

func task(_ n: Int, room: UUID, effort: Int = 2, kind: TaskKind = .recurring,
          recurrence: RecurrencePolicy = .recurring(frequency: .weekly, interval: 1),
          policy: TaskAssignmentPolicy = .calendarRotation, name: String? = nil) -> TaskDefinition {
    TaskDefinition(id: W.def(n), roomID: room, name: name ?? "Tarefa \(n)", details: "", effort: TaskEffort(points: effort),
                   kind: kind, recurrence: recurrence, assignmentPolicy: policy)
}

let wed = parse("2026-09-16T15:00:00Z")   // quarta-feira
func days(_ n: Int, from date: Date = wed) -> Date { date.addingTimeInterval(Double(n) * 86400) }

private func resolve(_ ref: Ref, in state: TaskSchedulingState) -> UUID? {
    let matching = state.occurrences.filter { $0.taskDefinitionID == ref.def }
    return matching.indices.contains(ref.n) ? matching[ref.n].id : nil
}

private func resolve(_ who: Who, in state: TaskSchedulingState) -> UUID? {
    switch who {
    case let .user(u): return u
    case let .assigneeOf(ref):
        guard let occ = resolve(ref, in: state) else { return nil }
        return state.assignments.last { $0.occurrenceID == occ && ($0.isActive || $0.endedAt != nil) }?.userID
    }
}

func apply(_ step: Step, service: TaskSchedulingService, state: inout TaskSchedulingState) throws -> Any? {
    switch step {
    case let .create(def, at): _ = try service.create(def, at: at, state: &state)
    case let .complete(ref, who, at):
        guard let occ = resolve(ref, in: state), let user = resolve(who, in: state) else { throw DomainError.entityNotFound }
        try service.complete(occurrenceID: occ, by: user, at: at, state: &state)
    case let .reopen(ref, who):
        guard let occ = resolve(ref, in: state), let user = resolve(who, in: state) else { throw DomainError.entityNotFound }
        try service.reopen(occurrenceID: occ, by: user, state: &state)
    case let .refresh(at): try service.refresh(houseID: W.house, at: at, state: &state)
    case let .addMember(user, room, at, replan): try service.addMember(userID: user, roomID: room, at: at, replan: replan, state: &state)
    case let .removeMember(user, room, at, confirm, houseChange, replan):
        try service.removeMember(userID: user, roomID: room, at: at, confirmDeletion: confirm, houseChange: houseChange, replan: replan, state: &state)
    case let .rebalance(boundary, at): try service.rebalance(houseID: W.house, boundary: boundary, at: at, state: &state)
    case let .addAbsence(a): state.absences.append(a)
    case let .suggestedResident(room, at): return opt(try service.suggestedResident(roomID: room, at: at, state: state)) { id($0) }
    }
    return nil
}

func run(_ scenario: Scenario) -> [String: Any] {
    let service = TaskSchedulingService(calendar: calendar(scenario.zone))
    var state = scenario.state
    var results: [Any] = []
    for step in scenario.steps {
        var working = state   // como o repositório: trabalha numa cópia e só publica no sucesso
        do {
            let value = try apply(step, service: service, state: &working)
            state = working
            var entry: [String: Any] = ["ok": true, "occurrences": state.occurrences.count, "assignments": state.assignments.count]
            if let value { entry["value"] = value }
            results.append(entry)
        } catch let error as DomainError {
            results.append(["error": "\(error)"])
        } catch {
            results.append(["error": "\(error)"])
        }
    }
    let input: [String: Any] = [
        "name": scenario.name, "zone": scenario.zone, "initial": enc(scenario.state),
        "steps": scenario.steps.map { enc($0, house: W.house) },
    ]
    let known = knownIDs(in: input)
    var map: [String: String] = [:]
    let final = normalizeNewIDs(enc(state), known: known, map: &map)
    var out = input
    out["results"] = results
    out["final"] = final
    return out
}

func generateScheduling(outDir: String) {
    let groups: [(String, [Scenario])] = [
        ("scheduling-create", createScenarios()),
        ("scheduling-complete", completeScenarios()),
        ("scheduling-membership", membershipScenarios()),
        ("scheduling-calendar", calendarScenarios()),
    ]
    for (name, scenarios) in groups {
        writeFixture(name: name, command: "scheduling", cases: scenarios.map(run), outDir: outDir)
    }
}
