import Foundation
import GrupuxoDomain

private let zones = ["UTC", "America/Sao_Paulo", "Asia/Tokyo", "America/New_York", "Australia/Lord_Howe", "Europe/London"]

/// Horários de parede locais "AAAA-MM-DD HH:mm:ss" por fuso, cobrindo virada de semana, lacunas e repetições do horário de verão.
private let localTimes: [String: [String]] = [
    "common": [
        "2026-09-13 23:59:59", "2026-09-14 00:00:00", "2026-09-14 00:00:01", "2026-09-16 12:00:00",
        "2026-09-20 23:59:59", "2026-09-21 00:00:00", "2026-01-31 12:00:00", "2024-02-29 12:00:00",
        "2026-12-31 23:59:59", "2027-01-01 00:00:00", "2026-03-31 09:30:00", "2026-05-31 18:00:00",
    ],
    "America/New_York": [
        "2026-03-07 02:30:00", "2026-03-08 00:00:00", "2026-03-08 01:30:00", "2026-03-08 03:30:00", "2026-03-08 02:30:00",
        "2026-03-09 02:30:00", "2026-10-31 01:30:00", "2026-11-01 00:00:00", "2026-11-01 00:30:00", "2026-11-01 01:30:00",
        "2026-11-01 02:30:00", "2026-11-02 01:30:00", "2026-03-07 23:59:59", "2026-03-14 02:30:00",
    ],
    "America/Sao_Paulo": [
        "2018-11-03 23:59:59", "2018-11-04 00:00:00", "2018-11-04 00:30:00", "2018-11-04 01:00:00", "2018-11-05 00:00:00",
        "2018-02-17 23:30:00", "2018-02-18 00:00:00", "2018-02-18 00:30:00", "2018-02-19 00:00:00",
        "2018-11-10 00:00:00", "2018-11-11 00:00:00", "2019-02-16 23:59:59", "2019-02-17 00:00:00",
    ],
    "Australia/Lord_Howe": [
        "2026-04-05 01:30:00", "2026-04-05 02:00:00", "2026-04-05 02:15:00", "2026-10-04 02:00:00", "2026-10-04 02:15:00", "2026-10-04 02:45:00",
        "2026-04-04 02:15:00", "2026-10-03 02:15:00",
    ],
    "Europe/London": [
        "2026-03-29 00:30:00", "2026-03-29 01:30:00", "2026-03-30 01:30:00", "2026-10-25 00:30:00", "2026-10-25 01:30:00", "2026-10-26 01:30:00",
    ],
]

private func localDate(_ text: String, _ cal: Calendar) -> Date {
    let p = text.split(whereSeparator: { $0 == "-" || $0 == " " || $0 == ":" }).map { Int($0)! }
    let c = DateComponents(year: p[0], month: p[1], day: p[2], hour: p[3], minute: p[4], second: p[5])
    return cal.date(from: c)!
}

func generateDates(outDir: String) {
    var cases: [Any] = []
    for zone in zones {
        let cal = calendar(zone)
        let service = TaskSchedulingService(calendar: cal)
        var instants = Set<Date>()
        for text in (localTimes["common"] ?? []) + (localTimes[zone] ?? []) { instants.insert(localDate(text, cal)) }
        // Instantes ao redor de cada transição de horário de verão (2018-2019 e 2026-2027).
        for (from, to) in [("2018-01-01T00:00:00Z", "2020-01-01T00:00:00Z"), ("2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z")] {
            var cursor = parse(from)
            let end = parse(to)
            while let next = cal.timeZone.nextDaylightSavingTimeTransition(after: cursor), next < end {
                for minutes in [-1560, -60, -1, 0, 30, 90] {
                    instants.insert(next.addingTimeInterval(Double(minutes) * 60))
                }
                cursor = next
            }
        }
        for instant in instants.sorted() {
            func date(_ body: () throws -> Date) -> Any { attempt(body) { iso($0) } }
            func int(_ body: () throws -> Int) -> Any { attempt(body) { $0 } }
            var ops: [String: Any] = [:]
            ops["weekStart"] = date { try service.weekStart(instant) }
            ops["startOfDay"] = iso(cal.startOfDay(for: instant))
            for n in [1, 2, 7, 30, 365] { ops["addDays\(n)"] = date { try service.adding(.day, n, to: instant) } }
            for n in [1, 12, 20] { ops["addWeeks\(n)"] = date { try service.addingWeeks(n, to: instant) } }
            for n in [1, 2, 12] { ops["addMonths\(n)"] = date { try service.adding(.month, n, to: instant) } }
            ops["addYears1"] = date { try service.adding(.year, 1, to: instant) }
            // Dias de calendário entre o início da semana e o início do dia de outra data.
            for k in [0, 1, 6, 7, 40, 200] {
                ops["daysBetween\(k)"] = int {
                    let later = try service.adding(.day, k, to: instant)
                    return cal.dateComponents([.day], from: try service.weekStart(instant), to: cal.startOfDay(for: later)).day!
                }
            }
            for k in [0, 3, 11, 12, 13] {
                ops["weekIndex\(k)"] = int {
                    try service.weekIndex(try service.addingWeeks(k, to: instant), start: try service.weekStart(instant))
                }
            }
            cases.append(["zone": zone, "instant": iso(instant), "ops": ops] as [String: Any])
        }
    }
    writeFixture(name: "dates-oracle", command: "dates", cases: cases, outDir: outDir)
}
