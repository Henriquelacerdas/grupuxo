import Foundation
import GrupuxoDomain

func generateHungarian(outDir: String) {
    var cases: [Any] = []
    var rng = Rng(seed: 11)
    let solver = HungarianAlgorithm()

    func scalar(_ name: String, _ matrix: [[Double]]) {
        let output = attempt({ try solver.solve(matrix: matrix) }) { $0 }
        cases.append(["name": name, "kind": "scalar", "matrix": matrix.map { $0.map(num) }, "output": output] as [String: Any])
    }
    scalar("vazia", [])
    scalar("1x1", [[7]])
    scalar("2x2 diagonal", [[1, 9], [9, 1]])
    scalar("2x2 empate total", [[0, 0], [0, 0]])
    scalar("3x3 clássica", [[4, 1, 3], [2, 0, 5], [3, 2, 2]])
    scalar("negativos", [[-5, 2, 0], [1, -3, 4], [0, 0, -1]])
    scalar("fracionários", [[0.5, 0.25, 0.75], [0.125, 0.5, 0.25], [0.75, 0.375, 0.5]])
    scalar("não quadrada 2x3", [[1, 2, 3], [4, 5, 6]])
    scalar("não quadrada 3x2", [[1, 2], [3, 4], [5, 6]])
    scalar("linha curta", [[1, 2], [3]])
    scalar("NaN", [[1, .nan], [2, 3]])
    scalar("infinito", [[1, .infinity], [2, 3]])
    scalar("menos infinito", [[1, -.infinity], [2, 3]])
    for size in 1...8 {
        for variant in 0..<6 {
            let matrix: [[Double]] = (0..<size).map { _ in
                (0..<size).map { _ in
                    switch variant {
                    case 0: Double(rng.int(3))                       // muitos empates
                    case 1: Double(rng.int(11) - 5)                  // negativos
                    case 2: Double(rng.int(9)) * 0.25                // frações exatas
                    case 3: Double(rng.int(1000)) / 7                // frações inexatas
                    case 4: 1                                        // constante
                    default: Double(rng.int(2)) * 100                // dois valores
                    }
                }
            }
            scalar("aleatória \(size)x\(size) v\(variant)", matrix)
        }
    }

    func lexicographic(_ name: String, _ matrix: [[ScheduleCost]]) {
        let output = attempt({ try solver.solve(costs: matrix) }) { $0 }
        cases.append(["name": name, "kind": "lexicographic", "costs": matrix.map { $0.map(encode) }, "output": output] as [String: Any])
    }
    lexicographic("vazia", [])
    lexicographic("1x1", [[ScheduleCost(effort: 1, difficulty: 2, debt: 3, changes: 4)]])
    lexicographic("infinito", [[ScheduleCost(effort: .infinity), ScheduleCost()], [ScheduleCost(), ScheduleCost()]])
    lexicographic("não quadrada", [[ScheduleCost(), ScheduleCost()]])
    for size in 1...6 {
        for variant in 0..<8 {
            let matrix: [[ScheduleCost]] = (0..<size).map { _ in
                (0..<size).map { _ in
                    switch variant % 4 {
                    case 0: ScheduleCost(effort: Double(rng.int(2)), difficulty: Double(rng.int(2)), debt: Double(rng.int(2)), changes: Double(rng.int(2)))
                    case 1: ScheduleCost(effort: Double(rng.int(3)), difficulty: Double(rng.int(3)), debt: Double(rng.int(5)) * 0.5, changes: Double(rng.int(4)))
                    case 2: ScheduleCost(effort: Double(rng.int(20)), difficulty: Double(rng.int(20)) / 2, debt: Double(rng.int(7) - 3) * 0.375, changes: Double(rng.int(3)))
                    default: ScheduleCost(effort: 4, difficulty: 2, debt: 0, changes: Double(rng.int(2)))
                    }
                }
            }
            lexicographic("aleatória \(size)x\(size) v\(variant)", matrix)
        }
    }
    writeFixture(name: "hungarian", command: "hungarian", cases: cases, outDir: outDir)
}

private func randomWeeks(_ rng: inout Rng) -> [ProjectedWeek] {
    (0..<12).map { _ in
        rng.chance(55) ? ProjectedWeek() : ProjectedWeek(
            load: Double(rng.int(7)), level1: Double(rng.int(3)), level2: Double(rng.int(3)), level3: Double(rng.int(2)))
    }
}

func generateDistributionEngine(outDir: String) {
    var cases: [Any] = []
    var rng = Rng(seed: 23)
    let engine = TaskDistributionEngine()
    let pool = (1...6).map(uid)

    func run(_ name: String, effort: Int, participants: [UUID], weeks: [Int], projection: [UUID: [ProjectedWeek]], debts: [UUID: Double]) {
        let output = attempt({ try engine.generateInitialQueue(taskEffort: effort, participants: participants, occurrenceWeeks: weeks, projection: projection, debts: debts) }) { ids($0) }
        cases.append([
            "name": name,
            "input": ["effort": effort, "participants": ids(participants), "weeks": weeks,
                      "projection": encode(projection), "debts": encode(debts)] as [String: Any],
            "output": output,
        ] as [String: Any])
    }
    let four = Array(pool.prefix(4))
    run("sem projeção, semanal", effort: 2, participants: four, weeks: Array(0..<12), projection: [:], debts: [:])
    run("participante único", effort: 1, participants: [pool[0]], weeks: [0, 1, 2], projection: [:], debts: [:])
    run("sem ocorrências", effort: 3, participants: four, weeks: [], projection: [:], debts: [:])
    run("mais ocorrências na mesma semana", effort: 2, participants: four, weeks: [0, 0, 0, 1, 1, 5, 5, 5, 5], projection: [:], debts: [:])
    run("saldos desiguais", effort: 2, participants: four, weeks: Array(0..<12), projection: [:],
        debts: [pool[0]: 3, pool[1]: -1.5, pool[2]: 0.75, pool[3]: -2.25])
    // erros
    run("sem participantes", effort: 2, participants: [], weeks: [0], projection: [:], debts: [:])
    run("participante duplicado", effort: 2, participants: [pool[0], pool[0]], weeks: [0], projection: [:], debts: [:])
    run("esforço 0", effort: 0, participants: four, weeks: [0], projection: [:], debts: [:])
    run("esforço 4", effort: 4, participants: four, weeks: [0], projection: [:], debts: [:])
    run("semana 12", effort: 1, participants: four, weeks: [12], projection: [:], debts: [:])
    run("semana negativa", effort: 1, participants: four, weeks: [-1], projection: [:], debts: [:])
    run("projeção com 11 semanas", effort: 1, participants: four, weeks: [0], projection: [pool[0]: Array(repeating: ProjectedWeek(), count: 11)], debts: [:])
    run("saldo infinito", effort: 1, participants: four, weeks: [0], projection: [:], debts: [pool[0]: .infinity])
    run("carga negativa", effort: 1, participants: four, weeks: [0], projection: [pool[0]: Array(repeating: ProjectedWeek(load: -1), count: 12)], debts: [:])
    for i in 0..<60 {
        let participants = rng.shuffled(rng.subset(pool, minimum: 1))
        let weeks = (0..<rng.int(15)).map { _ in rng.int(12) }.sorted()
        var projection: [UUID: [ProjectedWeek]] = [:]
        for user in pool where rng.chance(60) { projection[user] = randomWeeks(&rng) }
        var debts: [UUID: Double] = [:]
        for user in pool where rng.chance(50) { debts[user] = Double(rng.int(13) - 6) * 0.375 }
        run("aleatório \(i)", effort: 1 + rng.int(3), participants: participants, weeks: weeks, projection: projection, debts: debts)
    }
    writeFixture(name: "distribution-engine", command: "engine", cases: cases, outDir: outDir)
}

func generateHouseQueueOptimizer(outDir: String) {
    var cases: [Any] = []
    var rng = Rng(seed: 37)
    let optimizer = HouseQueueOptimizer()
    let pool = (1...5).map(uid)

    func encode(_ task: QueueForecast) -> [String: Any] {
        [
            "participants": ids(task.participants),
            "turns": task.turns.map { turn -> [String: Any] in
                ["week": turn.week, "effort": turn.effort, "eligible": sortedIds(turn.eligible),
                 "incumbent": turn.incumbent.map(id) as Any? ?? NSNull(), "slot": turn.slot as Any? ?? NSNull()]
            },
            "isFixed": task.isFixed,
            "existingQueue": ids(task.existingQueue),
        ]
    }
    func run(_ name: String, _ tasks: [QueueForecast], fixed: [UUID: [ProjectedWeek]], debts: [UUID: Double]) {
        let output = attempt({ try optimizer.optimize(tasks, fixed: fixed, debts: debts) }) { $0.map(ids) }
        cases.append([
            "name": name,
            "input": ["tasks": tasks.map(encode), "fixed": ENCODE_GRID(fixed), "debts": ENCODE_DEBTS(debts)] as [String: Any],
            "output": output,
        ] as [String: Any])
    }

    run("sem tarefas", [], fixed: [:], debts: [:])
    let simple = QueueForecast(participants: Array(pool.prefix(3)),
        turns: (0..<12).map { QueueForecast.Turn(week: $0, effort: 2, eligible: Set(pool.prefix(3)), incumbent: pool[$0 % 3]) },
        existingQueue: Array(pool.prefix(3)))
    run("uma fila semanal", [simple], fixed: [:], debts: [:])
    run("fila vazia de participantes", [QueueForecast(participants: [], turns: [], existingQueue: [])], fixed: [:], debts: [:])
    run("participantes duplicados", [QueueForecast(participants: [pool[0], pool[0]], turns: [], existingQueue: [])], fixed: [:], debts: [:])
    run("semana inválida", [QueueForecast(participants: [pool[0]], turns: [.init(week: 12, effort: 1, eligible: [pool[0]], incumbent: nil)], existingQueue: [])], fixed: [:], debts: [:])
    run("esforço inválido", [QueueForecast(participants: [pool[0]], turns: [.init(week: 0, effort: 4, eligible: [pool[0]], incumbent: nil)], existingQueue: [])], fixed: [:], debts: [:])
    run("slot negativo", [QueueForecast(participants: [pool[0]], turns: [.init(week: 0, effort: 1, eligible: [pool[0]], incumbent: nil, slot: -1)], existingQueue: [])], fixed: [:], debts: [:])
    run("saldo infinito", [simple], fixed: [:], debts: [pool[0]: .infinity])

    for i in 0..<80 {
        let taskCount = 1 + rng.int(4)
        let tasks: [QueueForecast] = (0..<taskCount).map { _ in
            let participants = rng.shuffled(rng.subset(pool, minimum: 1))
            let useSlots = rng.chance(40)
            let turns = (0..<rng.int(11)).map { _ in
                QueueForecast.Turn(week: rng.int(12), effort: 1 + rng.int(3),
                    eligible: Set(rng.chance(80) ? participants : rng.subset(pool)),
                    incumbent: rng.chance(30) ? nil : rng.pick(pool),
                    slot: useSlots ? rng.int(6) : nil)
            }
            let existing = rng.shuffled(rng.subset(rng.chance(15) ? pool : participants))
            return QueueForecast(participants: participants, turns: turns, isFixed: rng.chance(12), existingQueue: existing)
        }
        var fixed: [UUID: [ProjectedWeek]] = [:]
        for user in pool where rng.chance(40) { fixed[user] = randomWeeks(&rng) }
        var debts: [UUID: Double] = [:]
        for user in pool where rng.chance(60) { debts[user] = Double(rng.int(13) - 6) * 0.375 }
        run("aleatório \(i)", tasks, fixed: fixed, debts: debts)
    }
    writeFixture(name: "house-queue-optimizer", command: "optimizer", cases: cases, outDir: outDir)
}

// Aliases para evitar conflito de nomes com as funções locais `encode` acima.
private func ENCODE_GRID(_ grid: [UUID: [ProjectedWeek]]) -> [String: Any] { encode(grid) }
private func ENCODE_DEBTS(_ debts: [UUID: Double]) -> [String: Any] { encode(debts) }
