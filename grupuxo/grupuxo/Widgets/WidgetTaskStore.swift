import Foundation
import Security
import SwiftUI
import WidgetKit

/// Item de tarefa pendente serializado para exibição nos widgets.
struct WidgetTaskItem: Codable, Hashable, Identifiable, Sendable {
    let occurrenceID: UUID
    let taskDefinitionID: UUID
    let name: String
    let roomName: String?
    let dueAt: Date?
    let colorRawValue: String

    var id: UUID { occurrenceID }

    var tintColor: Color {
        switch colorRawValue {
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
        default: .accentColor
        }
    }

    var deepLinkURL: URL {
        URL(string: "grupuxo://tasks/\(taskDefinitionID.uuidString.lowercased())")
            ?? WidgetSnapshot.defaultURL
    }
}

/// Fotografia do estado das tarefas do morador compartilhada entre o app e a extensão de widgets.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    enum Status: String, Codable, Equatable, Sendable {
        case notSignedIn
        case noHouse
        case ready
    }

    let status: Status
    let houseName: String
    let tasks: [WidgetTaskItem]
    let updatedAt: Date

    static let defaultURL = URL(string: "grupuxo://tasks")!

    static func notSignedIn(at date: Date = .now) -> WidgetSnapshot {
        WidgetSnapshot(status: .notSignedIn, houseName: "", tasks: [], updatedAt: date)
    }

    static func noHouse(at date: Date = .now) -> WidgetSnapshot {
        WidgetSnapshot(status: .noHouse, houseName: "", tasks: [], updatedAt: date)
    }

    static func ready(houseName: String, tasks: [WidgetTaskItem], at date: Date = .now) -> WidgetSnapshot {
        WidgetSnapshot(status: .ready, houseName: houseName, tasks: tasks, updatedAt: date)
    }

    static var placeholder: WidgetSnapshot {
        WidgetSnapshot(
            status: .ready,
            houseName: String(localized: "Nossa Casa"),
            tasks: [
                WidgetTaskItem(
                    occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                    taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!,
                    name: String(localized: "Lavar a louça"),
                    roomName: String(localized: "Cozinha"),
                    dueAt: .now,
                    colorRawValue: "orange"
                ),
                WidgetTaskItem(
                    occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                    taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000012")!,
                    name: String(localized: "Tirar o lixo"),
                    roomName: String(localized: "Área de serviço"),
                    dueAt: .now,
                    colorRawValue: "teal"
                ),
                WidgetTaskItem(
                    occurrenceID: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!,
                    taskDefinitionID: UUID(uuidString: "00000000-0000-0000-0000-000000000013")!,
                    name: String(localized: "Regar as plantas"),
                    roomName: String(localized: "Sala"),
                    dueAt: nil,
                    colorRawValue: "green"
                ),
            ],
            updatedAt: .now
        )
    }
}

struct WidgetSessionCredentials: Codable, Equatable, Sendable {
    let baseURL: URL
    let accessToken: String
}

/// Armazenamento compartilhado entre o app principal e `GrupuxoWidgets` via Keychain Sharing
/// (`ZTK9F54WV3.vidal.grupuxo.shared`), que já é suportado pelos Provisioning Profiles existentes da equipe
/// sem depender de aprovação de novo App Group no portal da Apple.
///
/// Respeita a política de isolamento de sessão do projeto: `clear()` apaga imediatamente o snapshot e o token no logout
/// para que nenhuma informação fique acessível entre contas diferentes.
struct WidgetTaskStore: Sendable {
    static let keychainAccessGroup = "ZTK9F54WV3.vidal.grupuxo.shared"
    static let keychainService = "vidal.grupuxo.widget"
    static let widgetKind = "MyTasksWidget"
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

    func saveReady(houseName: String, tasks: [WidgetTaskItem], reloadWidgets: Bool = true) {
        let snapshot = WidgetSnapshot.ready(houseName: houseName, tasks: tasks)
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
        let updated = WidgetSnapshot.ready(
            houseName: current.houseName,
            tasks: current.tasks.filter { $0.occurrenceID != occurrenceID }
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
