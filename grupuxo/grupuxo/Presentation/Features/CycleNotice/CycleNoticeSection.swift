//
//  CycleNoticeSection.swift
//  grupuxo
//

import GrupuxoDomain
import SwiftUI
import UserNotifications
import Combine

/// Avisa quando o ciclo de um cômodo em que a pessoa participa vira.
///
/// O fim de cada ciclo vem do servidor (`periodEnd`). Como o ciclo tem tamanho fixo
/// (`intervalWeeks` semanas), o app agenda localmente os próximos ciclos de uma vez,
/// então o aviso chega mesmo sem abrir o app e sem internet.
@MainActor
final class CycleNoticeManager: ObservableObject {

    static let shared = CycleNoticeManager()

    /// Os avisos agendados começam com este prefixo (o toque abre "Minhas tarefas").
    nonisolated static let idPrefix = "grupuxo.cycle."

    /// Quantos ciclos à frente agendar por cômodo.
    private let horizonCycles = 8
    /// O iOS guarda no máximo 64 avisos pendentes; deixamos folga para os outros do app.
    private let maxNotifications = 40

    @Published private(set) var isEnabled: Bool
    @Published private(set) var hour: Int
    @Published private(set) var minute: Int
    @Published private(set) var message: String?

    private enum Key {
        static let enabled = "cycleNotice.enabled"
        static let hour = "cycleNotice.hour"
        static let minute = "cycleNotice.minute"
    }

    private let defaults = UserDefaults.standard

    private init() {
        let defaults = UserDefaults.standard
        isEnabled = defaults.bool(forKey: Key.enabled)
        hour = defaults.object(forKey: Key.hour) as? Int ?? 9
        minute = defaults.object(forKey: Key.minute) as? Int ?? 0

        // Remove o aviso semanal fixo, de uma versão anterior.
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: ["grupuxo.weekly"])
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
            message = String(localized: "Ative as notificações do Reveza em Ajustes para receber o aviso.")
            return
        }

        defaults.set(true, forKey: Key.enabled)
        isEnabled = true
        await reschedule()
    }

    /// Desliga e cancela os avisos (também usado no logout).
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

    /// Recalcula e agenda os próximos ciclos. Chamar no início do app e ao mudar o horário.
    func reschedule() async {
        guard isEnabled else { return }

        guard let context = try? await ShortcutBackend.context(),
              let overview = try? await context.container.makeGetHouseOverviewUseCase()(
                  houseID: context.session.currentHouse.id,
                  userID: context.session.currentUser.id,
                  at: Date()
              )
        else { return }

        let calendar = Calendar.current
        let now = Date()

        // Cômodos que viram no mesmo dia entram no mesmo aviso.
        var roomNamesByDate: [Date: [String]] = [:]
        for room in overview.rooms where room.isMember {
            let step = 7 * max(1, room.room.periodicity.intervalWeeks)
            for cycle in 0..<horizonCycles {
                guard let day = calendar.date(byAdding: .day, value: cycle * step, to: room.periodEnd),
                      let fire = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day),
                      fire > now
                else { continue }
                roomNamesByDate[fire, default: []].append(room.room.name)
            }
        }

        await removePending()

        let center = UNUserNotificationCenter.current()
        for (fire, names) in roomNamesByDate.sorted(by: { $0.key < $1.key }).prefix(maxNotifications) {
            let content = UNMutableNotificationContent()
            content.title = String(localized: "Novo ciclo começou")
            let list = ListFormatter.localizedString(byJoining: names.sorted())
            content.body = String(localized: "\(list): as próximas atividades já estão disponíveis. Toque para ver as suas.")
            content.sound = .default

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

/// Seção "Aviso de novo ciclo" dos ajustes da casa.
struct CycleNoticeSection: View {

    @ObservedObject private var manager = CycleNoticeManager.shared

    var body: some View {
        Section {
            Toggle(
                "Avisar quando o ciclo virar",
                isOn: Binding(
                    get: { manager.isEnabled },
                    set: { newValue in Task { await manager.setEnabled(newValue) } }
                )
            )

            if manager.isEnabled {
                DatePicker(
                    "Horário do aviso",
                    selection: Binding(get: { manager.time }, set: { manager.setTime($0) }),
                    displayedComponents: .hourAndMinute
                )
            }

            if let message = manager.message {
                Text(message).foregroundStyle(.red)
            }
        } header: {
            Text("Novo ciclo")
        } footer: {
            Text("No dia em que o ciclo de um cômodo seu recomeça, o Reveza avisa que as próximas atividades já estão disponíveis. Os avisos são agendados no aparelho e se atualizam quando você abre o app.")
        }
        .onAppear { manager.refresh() }
    }
}
