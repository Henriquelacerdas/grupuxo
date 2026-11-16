import Foundation
import Security
import SwiftUI
import WidgetKit

/// Item de tarefa pendente serializado para exibição nos widgets.
struct WidgetTaskItem: Codable, Hashable, Identifiable, Sendable {
    let occurrenceID: UUID
    let taskDefinitionID: UUID
    let roomID: UUID?
    let name: String
    let roomName: String?
    let roomIcon: String
    let dueAt: Date?
    let colorRawValue: String

    var id: UUID { occurrenceID }

    init(
        occurrenceID: UUID,
        taskDefinitionID: UUID,
        roomID: UUID? = nil,
        name: String,
        roomName: String?,
        roomIcon: String = "house.fill",
        dueAt: Date?,
        colorRawValue: String
    ) {
        self.occurrenceID = occurrenceID
        self.taskDefinitionID = taskDefinitionID
        self.roomID = roomID
        self.name = name
        self.roomName = roomName
        self.roomIcon = roomIcon
        self.dueAt = dueAt
        self.colorRawValue = colorRawValue
    }

    var tintColor: Color {
        Self.color(for: colorRawValue)
    }

    static func color(for rawValue: String) -> Color {
        switch rawValue {
        case "red": .red
        case "orange": .orange
        case "yellow": .yellow
        case "green": .green
        case "blue": .blue
        case "purple": .purple
        case "brown": .brown
        case "gray": .gray
        case "pink": .pink
        case "teal": .teal
        case "indigo": .indigo
        case "cyan": .cyan
        default: .orange
        }
    }

    var deepLinkURL: URL {
        URL(string: "grupuxo://tasks/\(taskDefinitionID.uuidString.lowercased())")
            ?? WidgetSnapshot.defaultURL
    }
}

/// Resumo de um cômodo para os widgets C1c (pequeno) e M5 (médio com lista de tarefas do cômodo).
struct WidgetRoomSummary: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let name: String
    let icon: String
    let colorRawValue: String
    /// Fim exclusivo do ciclo atual do cômodo.
    let periodEnd: Date?
    let completedCount: Int
    let totalCount: Int
    let pendingTasks: [WidgetTaskItem]

    var tintColor: Color {
        WidgetTaskItem.color(for: colorRawValue)
    }

    var progressFraction: Double {
        guard totalCount > 0 else {
            return pendingTasks.isEmpty ? 1.0 : 0.25
        }
        return min(max(Double(completedCount) / Double(totalCount), 0), 1)
    }

    var deepLinkURL: URL {
        WidgetSnapshot.defaultURL
    }
}

/// Formatação dos prazos exibidos nos widgets ("Terminou ontem", "Termina hoje", "Termina domingo").
enum WidgetDeadlineFormatter {
    struct FormattedDeadline: Equatable, Sendable {
        let text: String
        /// `true` quando vence hoje ou já venceu (exibido em negrito primário no M2).
        let isUrgent: Bool
    }

    static func format(dueAt: Date?, now: Date = .now, calendar: Calendar = .current, locale: Locale = .current) -> FormattedDeadline? {
        guard let dueAt else { return nil }
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: dueAt)
        ).day ?? 0

        switch days {
        case ..<(-1):
            return FormattedDeadline(text: String(localized: "Atrasada"), isUrgent: true)
        case -1:
            return FormattedDeadline(text: String(localized: "Terminou ontem"), isUrgent: true)
        case 0:
            return FormattedDeadline(text: String(localized: "Termina hoje"), isUrgent: true)
        case 1:
            return FormattedDeadline(text: String(localized: "Termina amanhã"), isUrgent: false)
        case 2..<7:
            let weekday = dueAt.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                    .weekday(.wide)
            )
            return FormattedDeadline(text: String(localized: "Termina \(weekday)"), isUrgent: false)
        default:
            return FormattedDeadline(text: String(localized: "Termina em \(days) dias"), isUrgent: false)
        }
    }

    static func formatCycleEnd(_ periodEnd: Date?, now: Date = .now, calendar: Calendar = .current, locale: Locale = .current) -> String {
        guard let periodEnd else { return String(localized: "Neste ciclo") }
        let lastDay = calendar.date(byAdding: .day, value: -1, to: periodEnd) ?? periodEnd
        let days = max(
            0,
            calendar.dateComponents(
                [.day],
                from: calendar.startOfDay(for: now),
                to: calendar.startOfDay(for: lastDay)
            ).day ?? 0
        )
        switch days {
        case 0:
            return String(localized: "Termina hoje")
        case 1:
            return String(localized: "Termina amanhã")
        case 2..<7:
            let weekday = lastDay.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                    .weekday(.wide)
            )
            return String(localized: "Termina \(weekday)")
        default:
            return String(localized: "Termina em \(days) dias")
        }
    }
}

/// Fotografia do estado das tarefas e cômodos do morador compartilhada entre o app e a extensão de widgets.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    enum Status: String, Codable, Equatable, Sendable {
        case notSignedIn
        case noHouse
        case ready
    }

    let status: Status
    let houseName: String
    let tasks: [WidgetTaskItem]
    let rooms: [WidgetRoomSummary]
    let updatedAt: Date

    static let defaultURL = URL(string: "grupuxo://tasks")!

    init(
        status: Status,
        houseName: String,
        tasks: [WidgetTaskItem],
        rooms: [WidgetRoomSummary] = [],
        updatedAt: Date
    ) {
        self.status = status
        self.houseName = houseName
        self.tasks = tasks
        self.rooms = rooms
        self.updatedAt = updatedAt
    }

    static func notSignedIn(at date: Date = .now) -> WidgetSnapshot {
        WidgetSnapshot(status: .notSignedIn, houseName: "", tasks: [], rooms: [], updatedAt: date)
    }

    static func noHouse(at date: Date = .now) -> WidgetSnapshot {
        WidgetSnapshot(status: .noHouse, houseName: "", tasks: [], rooms: [], updatedAt: date)
    }

    static func ready(
        houseName: String,
        tasks: [WidgetTaskItem],
        rooms: [WidgetRoomSummary] = [],
        at date: Date = .now
    ) -> WidgetSnapshot {
        WidgetSnapshot(status: .ready, houseName: houseName, tasks: tasks, rooms: rooms, updatedAt: date)
    }

    static var placeholder: WidgetSnapshot {
        let now = Date.now
        let cal = Calendar.current
        let yesterday = cal.date(byAdding: .day, value: -1, to: now) ?? now
        let inThreeDays = cal.date(byAdding: .day, value: 3, to: now) ?? now
        let cycleEnd = cal.date(byAdding: .day, value: 4, to: now) ?? now

        let kitchenID = UUID(uuidString: "00000000-0000-0000-0000-000000000101")!
        let livingRoomID = UUID(uuidString: "00000000-0000-0000-0000-000000000102")!
        let bathroomID = UUID(uuidString: "00000000-0000-0000-0000-000000000103")!

        let trashTask = WidgetTaskItem(
            occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!,
            roomID: livingRoomID,
            name: String(localized: "Tirar o lixo"),
            roomName: String(localized: "Sala"),
            roomIcon: "sofa.fill",
            dueAt: yesterday,
            colorRawValue: "brown"
        )
        let sinkTask = WidgetTaskItem(
            occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
            taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000012")!,
            roomID: kitchenID,
            name: String(localized: "Limpar a pia"),
            roomName: String(localized: "Cozinha"),
            roomIcon: "frying.pan.fill",
            dueAt: now,
            colorRawValue: "orange"
        )
        let showerTask = WidgetTaskItem(
            occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!,
            taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000013")!,
            roomID: bathroomID,
            name: String(localized: "Lavar o box"),
            roomName: String(localized: "Banheiro"),
            roomIcon: "shower.fill",
            dueAt: inThreeDays,
            colorRawValue: "cyan"
        )
        let stoveTask = WidgetTaskItem(
            occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000004")!,
            taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000014")!,
            roomID: kitchenID,
            name: String(localized: "Limpar o fogão"),
            roomName: String(localized: "Cozinha"),
            roomIcon: "frying.pan.fill",
            dueAt: inThreeDays,
            colorRawValue: "orange"
        )

        let kitchenRoom = WidgetRoomSummary(
            id: kitchenID,
            name: String(localized: "Cozinha"),
            icon: "frying.pan.fill",
            colorRawValue: "orange",
            periodEnd: cycleEnd,
            completedCount: 1,
            totalCount: 3,
            pendingTasks: [sinkTask, stoveTask]
        )
        let livingRoom = WidgetRoomSummary(
            id: livingRoomID,
            name: String(localized: "Sala"),
            icon: "sofa.fill",
            colorRawValue: "brown",
            periodEnd: cycleEnd,
            completedCount: 1,
            totalCount: 2,
            pendingTasks: [trashTask]
        )
        let bathroomRoom = WidgetRoomSummary(
            id: bathroomID,
            name: String(localized: "Banheiro"),
            icon: "shower.fill",
            colorRawValue: "cyan",
            periodEnd: cycleEnd,
            completedCount: 0,
            totalCount: 1,
            pendingTasks: [showerTask]
        )

        return WidgetSnapshot(
            status: .ready,
            houseName: String(localized: "Nossa Casa"),
            tasks: [trashTask, sinkTask, showerTask, stoveTask],
            rooms: [kitchenRoom, livingRoom, bathroomRoom],
            updatedAt: now
        )
    }
}

struct WidgetSessionCredentials: Codable, Equatable, Sendable {
    let baseURL: URL
    let accessToken: String
}

/// Armazenamento compartilhado entre o app principal e `GrupuxoWidgets` via Keychain Sharing
/// (`ZTK9F54WV3.vidal.grupuxo.shared`).
///
/// Respeita a política de isolamento de sessão do projeto: `clear()` apaga imediatamente o snapshot e o token no logout
/// para que nenhuma informação fique acessível entre contas diferentes.
struct WidgetTaskStore: Sendable {
    static let keychainAccessGroup = "ZTK9F54WV3.vidal.grupuxo.shared"
    static let keychainService = "vidal.grupuxo.widget"
    static let widgetKind = "MyTasksWidget"
    static let roomWidgetKind = "RoomTasksWidget"
    static let shared = WidgetTaskStore()

    private let directoryURL: URL?
    private let suiteName: String?

    private static let snapshotKey = "grupuxo.widget.snapshot"
    private static let credentialsKey = "grupuxo.widget.credentials"

    init(
        directoryURL: URL? = nil,
        suiteName: String? = nil
    ) {
        self.directoryURL = directoryURL
        self.suiteName = suiteName
    }

    func loadSnapshot() -> WidgetSnapshot {
        if let data = readData(key: Self.snapshotKey),
           let decoded = try? Self.makeDecoder().decode(WidgetSnapshot.self, from: data) {
            return decoded
        }
        return .notSignedIn()
    }

    func saveReady(
        houseName: String,
        tasks: [WidgetTaskItem],
        rooms: [WidgetRoomSummary] = [],
        reloadWidgets: Bool = true
    ) {
        let snapshot = WidgetSnapshot.ready(houseName: houseName, tasks: tasks, rooms: rooms)
        saveSnapshot(snapshot, reloadWidgets: reloadWidgets)
    }

    func saveNoHouse(reloadWidgets: Bool = true) {
        let current = loadSnapshot()
        guard current.status != .noHouse || !current.tasks.isEmpty else { return }
        saveSnapshot(.noHouse(), reloadWidgets: reloadWidgets)
    }

    /// Apaga qualquer estado compartilhado e credenciais (chamar sempre no logout).
    func clear(reloadWidgets: Bool = true) {
        removeData(key: Self.snapshotKey)
        removeData(key: Self.credentialsKey)
        if reloadWidgets {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Remove otimisticamente a tarefa concluída e devolve o snapshot anterior caso seja preciso restaurar.
    @discardableResult
    func removeTaskOptimistically(occurrenceID: UUID, reloadWidgets: Bool = true) -> WidgetSnapshot? {
        let current = loadSnapshot()
        guard current.status == .ready,
              current.tasks.contains(where: { $0.occurrenceID == occurrenceID }) else {
            return nil
        }
        let updatedRooms = current.rooms.map { room -> WidgetRoomSummary in
            guard room.pendingTasks.contains(where: { $0.occurrenceID == occurrenceID }) else {
                return room
            }
            return WidgetRoomSummary(
                id: room.id,
                name: room.name,
                icon: room.icon,
                colorRawValue: room.colorRawValue,
                periodEnd: room.periodEnd,
                completedCount: room.completedCount + 1,
                totalCount: max(room.totalCount, room.completedCount + 1),
                pendingTasks: room.pendingTasks.filter { $0.occurrenceID != occurrenceID }
            )
        }
        let updated = WidgetSnapshot.ready(
            houseName: current.houseName,
            tasks: current.tasks.filter { $0.occurrenceID != occurrenceID },
            rooms: updatedRooms
        )
        saveSnapshot(updated, reloadWidgets: reloadWidgets)
        return current
    }

    func restoreSnapshot(_ snapshot: WidgetSnapshot, reloadWidgets: Bool = true) {
        saveSnapshot(snapshot, reloadWidgets: reloadWidgets)
    }

    func saveCredentials(baseURL: URL, accessToken: String) {
        let credentials = WidgetSessionCredentials(baseURL: baseURL, accessToken: accessToken)
        guard let data = try? Self.makeEncoder().encode(credentials) else { return }
        writeData(data, key: Self.credentialsKey)
    }

    func loadCredentials() -> WidgetSessionCredentials? {
        guard let data = readData(key: Self.credentialsKey) else {
            return nil
        }
        return try? Self.makeDecoder().decode(WidgetSessionCredentials.self, from: data)
    }

    /// Conclui a ocorrência diretamente na API usando as credenciais compartilhadas (usado quando o intent roda na extensão).
    func completeRemotely(occurrenceID: UUID) async throws {
        guard let credentials = loadCredentials() else {
            throw URLError(.userAuthenticationRequired)
        }
        let path = "v1/occurrences/\(occurrenceID.uuidString.lowercased())/complete"
        let url = credentials.baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }

    // MARK: - Persistência interna (Keychain compartilhado + armazenamento isolado para testes)

    private func saveSnapshot(_ snapshot: WidgetSnapshot, reloadWidgets: Bool) {
        let previous = loadSnapshot()
        let changed = previous.status != snapshot.status
            || previous.houseName != snapshot.houseName
            || previous.tasks != snapshot.tasks
            || previous.rooms != snapshot.rooms
        guard let data = try? Self.makeEncoder().encode(snapshot) else { return }
        writeData(data, key: Self.snapshotKey)
        if reloadWidgets && changed {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private func writeData(_ data: Data, key: String) {
        if let directoryURL {
            let fileURL = directoryURL.appendingPathComponent("\(key).json")
            try? data.write(to: fileURL, options: [.atomic])
            if let suiteName {
                UserDefaults(suiteName: suiteName)?.set(data, forKey: key)
            }
            return
        }
        if !writeKeychain(data, account: key, accessGroup: Self.keychainAccessGroup) {
            _ = writeKeychain(data, account: key, accessGroup: nil)
        }
    }

    private func readData(key: String) -> Data? {
        if let directoryURL {
            let fileURL = directoryURL.appendingPathComponent("\(key).json")
            if let data = try? Data(contentsOf: fileURL) {
                return data
            }
            if let suiteName {
                return UserDefaults(suiteName: suiteName)?.data(forKey: key)
            }
            return nil
        }
        if let data = readKeychain(account: key, accessGroup: Self.keychainAccessGroup) {
            return data
        }
        return readKeychain(account: key, accessGroup: nil)
    }

    private func removeData(key: String) {
        if let directoryURL {
            let fileURL = directoryURL.appendingPathComponent("\(key).json")
            try? FileManager.default.removeItem(at: fileURL)
            if let suiteName {
                UserDefaults(suiteName: suiteName)?.removeObject(forKey: key)
            }
            return
        }
        deleteKeychain(account: key, accessGroup: Self.keychainAccessGroup)
        deleteKeychain(account: key, accessGroup: nil)
    }

    private func baseQuery(account: String, accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    private func writeKeychain(_ data: Data, account: String, accessGroup: String?) -> Bool {
        let query = baseQuery(account: account, accessGroup: accessGroup)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            return true
        }
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery.merge(attributes) { _, new in new }
            return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
        }
        return false
    }

    private func readKeychain(account: String, accessGroup: String?) -> Data? {
        var query = baseQuery(account: account, accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private func deleteKeychain(account: String, accessGroup: String?) {
        let query = baseQuery(account: account, accessGroup: accessGroup)
        SecItemDelete(query as CFDictionary)
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }
}
