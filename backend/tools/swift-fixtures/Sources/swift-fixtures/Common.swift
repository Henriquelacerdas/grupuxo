import Foundation
import GrupuxoDomain

let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = TimeZone(identifier: "UTC")!
    return f
}()

func iso(_ date: Date) -> String { isoFormatter.string(from: date) }
func parse(_ text: String) -> Date { isoFormatter.date(from: text)! }

func calendar(_ zone: String) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: zone)!
    return cal
}

func compactJSON(_ object: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed])
    return String(decoding: data, as: UTF8.self)
}

/// Uma linha por caso, para o diff do git ficar legível.
func writeFixture(name: String, command: String, extra: [String: Any] = [:], cases: [Any], outDir: String) {
    var lines: [String] = []
    let header: [String: Any] = [
        "_generated": "swift-fixtures \(command) (GrupuxoDomain, Swift \(swiftVersion)); regenerar com: swift run --package-path backend/tools/swift-fixtures swift-fixtures \(command) backend/test/fixtures",
    ]
    var head = header
    for (k, v) in extra { head[k] = v }
    var headerText = compactJSON(head)
    headerText.removeFirst(); headerText.removeLast()
    lines.append("{" + headerText + ",\"cases\":[")
    for (i, c) in cases.enumerated() {
        lines.append("  " + compactJSON(c) + (i == cases.count - 1 ? "" : ","))
    }
    lines.append("]}")
    let path = outDir + "/" + name + ".json"
    try! (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
    print("wrote \(path) (\(cases.count) casos)")
}

let swiftVersion = "6.3"

/// Resultado ou erro de uma operação, como valor JSON.
func attempt<T>(_ body: () throws -> T, _ encode: (T) -> Any) -> Any {
    do { return encode(try body()) } catch let e as DomainError { return ["error": "\(e)"] } catch { return ["error": "\(error)"] }
}

/// Gerador determinístico (LCG): as fixtures são reproduzíveis.
struct Rng {
    var state: UInt64
    init(seed: UInt64) { state = seed &* 6364136223846793005 &+ 1442695040888963407 }
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state >> 33
    }
    mutating func int(_ bound: Int) -> Int { Int(next() % UInt64(bound)) }
    mutating func chance(_ percent: Int) -> Bool { int(100) < percent }
    mutating func pick<T>(_ items: [T]) -> T { items[int(items.count)] }
    mutating func subset<T>(_ items: [T], minimum: Int = 0) -> [T] {
        var chosen = items.filter { _ in chance(50) }
        while chosen.count < minimum { chosen = items.filter { _ in chance(60) } }
        return chosen
    }
    mutating func shuffled<T>(_ items: [T]) -> [T] {
        var result = items
        for i in stride(from: result.count - 1, to: 0, by: -1) { result.swapAt(i, int(i + 1)) }
        return result
    }
}

/// IDs legíveis e com ordem embaralhada em relação a `n`, para exercitar o desempate por UUID.
func uid(_ n: Int) -> UUID {
    let scrambled = (UInt64(n) &* 2654435761) % 0xFFFF_FFFF
    return UUID(uuidString: String(format: "%08llx-0000-4000-8000-%012llx", scrambled, UInt64(n)))!
}

func id(_ u: UUID) -> String { u.uuidString.lowercased() }
func ids(_ list: [UUID]) -> [String] { list.map(id) }
func sortedIds(_ set: Set<UUID>) -> [String] { set.map(id).sorted() }

/// Números que o JSON não representa viram texto.
func num(_ d: Double) -> Any {
    if d.isNaN { return "NaN" }
    if d == .infinity { return "Infinity" }
    if d == -.infinity { return "-Infinity" }
    return d
}

/// Semana projetada como `[carga, nível1, nível2, nível3]`, para manter as fixtures compactas.
func encode(_ week: ProjectedWeek) -> [Any] {
    [num(week.load), num(week.level1), num(week.level2), num(week.level3)]
}

func encode(_ grid: [UUID: [ProjectedWeek]]) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: grid.map { (id($0.key), $0.value.map(encode)) })
}

func encode(_ debts: [UUID: Double]) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: debts.map { (id($0.key), num($0.value)) })
}

func encode(_ cost: ScheduleCost) -> [String: Any] {
    ["effort": num(cost.effort), "difficulty": num(cost.difficulty), "debt": num(cost.debt), "changes": num(cost.changes)]
}
