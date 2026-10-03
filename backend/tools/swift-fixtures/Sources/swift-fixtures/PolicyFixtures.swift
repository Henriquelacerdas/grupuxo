import Foundation
import GrupuxoDomain

private let policyNow = parse("2026-09-16T15:00:00Z")
private let houseB = uid(1001)

func generatePolicies(outDir: String) {
    var cases: [Any] = []
    let swapPolicy = TaskSwapEligibilityPolicy()
    let viewPolicy = TaskEligibilityPolicy()
    let users = (1...4).map(uid)
    for w in 0..<20 {
        var rng = Rng(seed: UInt64(900 + w))
        let rooms = [
            room(W.kitchen, "Cozinha"), room(W.bathroom, "Banheiro"),
            Room(id: uid(150), houseID: houseB, name: "Outra casa", kind: .standard, visibility: .common),
        ]
        var houseMemberships: [HouseMembership] = []
        for (i, u) in users.enumerated() {
            if rng.chance(92) { houseMemberships.append(HouseMembership(id: uid(300 + i + 1), houseID: W.house, userID: u)) }
            if rng.chance(35) { houseMemberships.append(HouseMembership(id: uid(320 + i + 1), houseID: houseB, userID: u)) }
        }
        var roomMemberships: [RoomMembership] = []
        for r in rooms { for u in users where rng.chance(88) {
            roomMemberships.append(RoomMembership(id: uid(200 + roomMemberships.count + 1), roomID: r.id, userID: u,
                leftAt: rng.chance(12) ? days(-rng.int(10), from: policyNow) : nil))
        } }
        var absences: [Absence] = []
        for hm in houseMemberships where rng.chance(15) {
            absences.append(try! Absence(id: uid(500 + absences.count), membershipID: hm.id,
                startsAt: days(-rng.int(5), from: policyNow), endsAt: days(rng.int(5), from: policyNow)))
        }
        var items: [TaskItem] = []
        for n in 0..<8 {
            let roomID = rng.pick(rooms).id
            let definition = task(n + 1, room: roomID, effort: 1 + rng.int(3), kind: rng.chance(30) ? .sporadic : .recurring,
                recurrence: .recurring(frequency: .weekly, interval: 1))
            let completed = rng.chance(10)
            let occurrence = TaskOccurrence(id: uid(600 + n), taskDefinitionID: definition.id,
                availableAt: days(rng.int(5) - 3, from: policyNow), dueAt: nil,
                status: completed ? .completed : .assigned, completedAt: completed ? policyNow : nil,
                completedByUserID: nil, effortSnapshot: definition.effort)
            var assignment: TaskAssignment? = nil
            if rng.chance(90) {
                assignment = TaskAssignment(id: uid(700 + n), occurrenceID: occurrence.id, userID: rng.pick(users),
                    assignedAt: policyNow, endedAt: rng.chance(5) ? policyNow : nil, supersededAt: rng.chance(4) ? policyNow : nil)
            }
            items.append(TaskItem(definition: definition, occurrence: occurrence, assignment: assignment))
        }
        func roomOf(_ item: TaskItem) -> Room { rooms.first { $0.id == item.definition.roomID }! }
        let canOffer = items.map { item in users.map { swapPolicy.canOffer(item, by: $0, at: policyNow) } }
        let canReceive = items.map { item in
            users.map { swapPolicy.canReceive(item, room: roomOf(item), userID: $0, houseMemberships: houseMemberships,
                roomMemberships: roomMemberships, absences: absences, at: policyNow) }
        }
        let canView = items.map { item in
            users.map { viewPolicy.canView(item.definition, room: roomOf(item), userID: $0, roomMemberships: roomMemberships) }
        }
        let canClaim = items.map { item in
            users.map { viewPolicy.canClaim(item, room: roomOf(item), userID: $0, roomMemberships: roomMemberships) }
        }
        var requesters: [[UUID]] = []
        let canSwap: [[Bool]] = items.map { a in
            items.map { b in
                swapPolicy.canSwap(offeredItem: a, requestedItem: b, offeredRoom: roomOf(a), requestedRoom: roomOf(b),
                    requesterID: a.assignment?.userID ?? users[0], receiverID: b.assignment?.userID ?? users[1],
                    houseMemberships: houseMemberships, roomMemberships: roomMemberships, absences: absences, at: policyNow)
            }
        }
        _ = requesters; requesters = []
        cases.append([
            "name": "mundo \(w)",
            "now": d(policyNow),
            "users": ids(users),
            "rooms": rooms.map(enc),
            "houseMemberships": houseMemberships.map { ["id": id($0.id), "houseID": id($0.houseID), "userID": id($0.userID)] as [String: Any] },
            "roomMemberships": roomMemberships.map(enc),
            "absences": absences.map(enc),
            "items": items.map { item -> [String: Any] in
                ["definition": enc(item.definition), "occurrence": enc(item.occurrence), "assignment": opt(item.assignment) { enc($0) }]
            },
            "canOffer": canOffer, "canReceive": canReceive, "canView": canView, "canClaim": canClaim, "canSwap": canSwap,
        ] as [String: Any])
    }
    writeFixture(name: "policies", command: "policies", cases: cases, outDir: outDir)
}

func generateFairnessAndLoad(outDir: String) {
    var fairness: [Any] = []
    var rng = Rng(seed: 71)
    let calc = FairnessCalculator()
    let pool = (1...6).map(uid)
    for i in 0..<48 {
        let eligible = (0..<rng.int(6)).map { _ in rng.pick(pool) }      // pode ter duplicatas e ser vazia
        let executor = rng.chance(85) ? rng.pick(pool) : uid(99)
        let effort = i < 6 ? [0, 4, -1, 1, 2, 3][i] : 1 + rng.int(3)
        let output = attempt({ try calc.calculateDebtImpact(effort: effort, executorID: executor, eligibleUserIDs: eligible) }) {
            Dictionary(uniqueKeysWithValues: $0.map { (id($0.key), num($0.value)) })
        }
        fairness.append(["effort": effort, "executor": id(executor), "eligible": ids(eligible), "output": output] as [String: Any])
    }
    writeFixture(name: "fairness", command: "fairness", cases: fairness, outDir: outDir)

    var load: [Any] = []
    let rotation = RotationCalculator()
    let loadCalc = WeeklyLoadCalculator()
    for i in 0..<40 {
        let zone = ["UTC", "America/Sao_Paulo", "Asia/Tokyo", "America/New_York"][i % 4]
        let cal = calendar(zone)
        let base = parse(["2026-09-13T00:00:00Z", "2026-03-08T00:00:00Z", "2026-11-01T00:00:00Z", "2026-12-28T00:00:00Z"][rng.int(4)])
        let users = Array(pool.prefix(3))
        var occurrences: [TaskOccurrence] = []
        var assignments: [TaskAssignment] = []
        for n in 0..<10 {
            let availableAt = base.addingTimeInterval(Double(rng.int(14 * 24 * 4)) * 900 - 3 * 86400)
            let completed = rng.chance(25)
            let by = rng.pick(users)
            let occ = TaskOccurrence(id: uid(600 + n), taskDefinitionID: W.def(1), availableAt: availableAt, dueAt: nil,
                status: completed ? .completed : .assigned, completedAt: completed ? availableAt : nil,
                completedByUserID: completed ? by : nil, effortSnapshot: TaskEffort(points: 1 + rng.int(3)))
            occurrences.append(occ)
            if rng.chance(85) {
                assignments.append(TaskAssignment(id: uid(700 + n), occurrenceID: occ.id, userID: rng.pick(users), assignedAt: availableAt,
                    endedAt: rng.chance(15) ? availableAt : nil, supersededAt: rng.chance(10) ? availableAt : nil))
            }
        }
        let reference = base.addingTimeInterval(Double(rng.int(9 * 24 * 4)) * 900)
        let user = rng.pick(users)
        let points = loadCalc.calculate(for: user, assignments: assignments, occurrences: occurrences, referenceDate: reference, calendar: cal).points
        load.append([
            "zone": zone, "userID": id(user), "referenceDate": d(reference),
            "occurrences": occurrences.map(enc), "assignments": assignments.map(enc), "output": points,
        ] as [String: Any])
    }
    writeFixture(name: "weekly-load", command: "fairness", cases: load, outDir: outDir)

    var rot: [Any] = []
    let queue = Array(pool.prefix(4))
    for index in [-1, 0, 1, 2, 3, 4] {
        rot.append(["op": "advance", "index": index, "queue": ids(queue),
                    "output": attempt({ try rotation.advance(index: index, queue: queue) }) { $0 }] as [String: Any])
    }
    rot.append(["op": "advance", "index": 0, "queue": [], "output": attempt({ try rotation.advance(index: 0, queue: []) }) { $0 }] as [String: Any])
    for current in [nil, queue[0], queue[3], uid(99)] as [UUID?] {
        for eligible in [queue, [], [queue[2]], Array(queue.reversed())] {
            let next = rotation.nextUser(after: current, eligibleUserIDs: eligible)
            rot.append(["op": "nextUser", "current": opt(current) { id($0) }, "eligible": ids(eligible), "output": opt(next) { id($0) }] as [String: Any])
        }
    }
    writeFixture(name: "rotation", command: "fairness", cases: rot, outDir: outDir)
}
