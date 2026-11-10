import Foundation
@preconcurrency import EventKit

extension Notification.Name {
    /// Postada quando o morador liga a sincronização com o Lembretes (a desligada limpa os lembretes por conta própria).
    static let reminderSyncDidEnable = Notification.Name("reveza.reminderSyncDidEnable")
}

/// Vínculo entre um lembrete do iOS e uma ocorrência de tarefa, guardado na URL do lembrete.
enum ReminderLink {
    private static let scheme = "grupuxo"
    private static let host = "occurrence"

    static func url(for occurrenceID: UUID) -> URL? {
        URL(string: "\(scheme)://\(host)/\(occurrenceID.uuidString)")
    }

    static func occurrenceID(from url: URL?) -> UUID? {
        guard let url, url.scheme == scheme, url.host == host else { return nil }
        return UUID(uuidString: url.lastPathComponent)
    }
}

/// Opt-in do morador para criar lembretes das próprias tarefas no app Lembretes.
/// É por aparelho e por sessão: o logout desliga (e apaga os lembretes), então outra conta nunca herda.
struct ReminderSyncPreference {
    static let key = "reminderSyncEnabled"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isEnabled: Bool { defaults.bool(forKey: Self.key) }

    func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.key)
    }
}

/// Acesso ao Lembretes e limpeza dos lembretes criados pelo app (os que têm `ReminderLink`).
struct ReminderLinkCleaner: Sendable {

    /// Pede acesso total ao Lembretes. `true` se concedido.
    func requestAccess() async -> Bool {
        let store = EKEventStore()
        return (try? await store.requestFullAccessToReminders()) ?? false
    }

    /// Apaga todos os lembretes vinculados a ocorrências. Sem permissão não faz nada.
    @discardableResult
    func removeAll() async -> Int {
        await remove { _ in true }
    }

    private func remove(where shouldRemove: @escaping @Sendable (UUID) -> Bool) async -> Int {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { return 0 }
        let store = EKEventStore()
        let predicate = store.predicateForReminders(in: nil)
        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                var removed = 0
                for reminder in reminders ?? [] {
                    guard let id = ReminderLink.occurrenceID(from: reminder.url), shouldRemove(id) else { continue }
                    if (try? store.remove(reminder, commit: false)) != nil { removed += 1 }
                }
                if removed > 0 { _ = try? store.commit() }
                continuation.resume(returning: removed)
            }
        }
    }
}
