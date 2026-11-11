//
//  DailyTasksNoticeManager.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 11/11/26.
//


//
//  DailyTasksNoticeManager.swift
//  grupuxo
//

import Combine
import GrupuxoDomain
import SwiftUI
import UserNotifications

/// Resumo diário das tarefas pendentes da pessoa, como notificação urgente (Time Sensitive).
///
/// O iOS só entrega notificações locais com o texto fixado no agendamento. Por isso o app
/// agenda os próximos dias de uma vez, com a lista de tarefas de agora, e refaz o
/// agendamento sempre que abre ou que as tarefas mudam.
@MainActor
final class DailyTasksNoticeManager: ObservableObject {

    static let shared = DailyTasksNoticeManager()

    /// Os avisos agendados começam com este prefixo (o toque abre "Minhas tarefas").
    nonisolated static let idPrefix = "grupuxo.daily."

    /// Quantos dias à frente agendar.
    private let daysAhead = 7
    /// Quantos nomes de tarefa cabem no corpo do aviso.
    private let maximumNames = 5

    @Published private(set) var isEnabled: Bool
    @Published private(set) var hour: Int
    @Published private(set) var minute: Int
    @Published private(set) var message: String?

    private enum Key {
        static let enabled = "dailyNotice.enabled"
        static let hour = "dailyNotice.hour"
        static let minute = "dailyNotice.minute"
    }

    private let defaults = UserDefaults.standard

    private init() {
        let defaults = UserDefaults.standard
        isEnabled = defaults.bool(forKey: Key.enabled)
        hour = defaults.object(forKey: Key.hour) as? Int ?? 8
        minute = defaults.object(forKey: Key.minute) as? Int ?? 0
    }

    var time: Date {
        Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
    }

    func refresh() {
        isEnabled = defaults.bool(forKey: Key.enabled)
    }

    func setEnabled(_ enabled: Bool) async {
        message = nil

        guard enabled else {
            disable()
            return
        }

        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            message = String(localized: "Ative as notificações do Reveza em Ajustes para receber o resumo.")
            return
        }

        defaults.set(true, forKey: Key.enabled)
        isEnabled = true
        await reschedule()
    }

    /// Desliga e cancela os avisos. Chamar também no logout: o texto traz tarefas da pessoa.
    func disable() {
        defaults.set(false, forKey: Key.enabled)
        isEnabled = false
        Task { await removePending() }
    }

    func setTime(_ date: Date) {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        hour = parts.hour ?? 8
        minute = parts.minute ?? 0
        defaults.set(hour, forKey: Key.hour)
        defaults.set(minute, forKey: Key.minute)
        Task { await reschedule() }
    }

    /// Busca as tarefas pendentes e agenda os próximos dias.
    func reschedule() async {
        guard isEnabled else { return }

        guard let context = try? await ShortcutBackend.context(),
              let tasks = try? await GetMyTasksUseCase(
                  repository: context.container.taskRepository
              )(
                  userID: context.session.currentUser.id,
                  houseID: context.session.currentHouse.id
              )
        else { return }

        let pending = tasks.filter { !$0.occurrence.isCompleted }

        await removePending()
        // Sem tarefas pendentes, não há o que avisar.
        guard !pending.isEmpty else { return }

        let content = UNMutableNotificationContent()
        content.title = pending.count == 1
            ? String(localized: "Você tem 1 tarefa pendente")
            : String(localized: "Você tem \(pending.count) tarefas pendentes")

        var lines = pending.prefix(maximumNames).map { "• \($0.definition.name)" }
        if pending.count > maximumNames {
            lines.append(String(localized: "e mais \(pending.count - maximumNames)"))
        }
        content.body = lines.joined(separator: "\n")
        content.sound = .default
        // Urgente: pode furar o resumo de notificações e alguns Focos.
        content.interruptionLevel = .timeSensitive
        content.relevanceScore = 1

        let calendar = Calendar.current
        let now = Date()
        let center = UNUserNotificationCenter.current()

        for offset in 0..<daysAhead {
            guard let day = calendar.date(byAdding: .day, value: offset, to: now),
                  let fire = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day),
                  fire > now
            else { continue }

            let trigger = UNCalendarNotificationTrigger(
                dateMatching: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire),
                repeats: false
            )
            let id = Self.idPrefix + String(Int(fire.timeIntervalSince1970))
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
    }

    private func removePending() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(Self.idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
}
