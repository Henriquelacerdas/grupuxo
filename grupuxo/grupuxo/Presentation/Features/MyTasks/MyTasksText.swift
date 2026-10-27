import Foundation
import GrupuxoDomain

/// Textos da tela Minhas tarefas. Calendário, localidade e relógio chegam por parâmetro, sem valores globais.
struct MyTasksText {

    let calendar: Calendar
    let locale: Locale

    private let houseText: HouseOverviewText

    init(calendar: Calendar = .current, locale: Locale = HouseOverviewText.appLocale) {
        self.calendar = calendar
        self.locale = locale
        self.houseText = HouseOverviewText(calendar: calendar, locale: locale)
    }

    /// "Termina domingo · 2 de 5"; sem tarefas no ciclo, só o prazo.
    func cycleStatus(periodEnd: Date, progress: CycleProgress, now: Date) -> String {

        let deadline = houseText.deadline(cycleEnd: periodEnd, now: now)

        guard progress.total > 0 else { return deadline }

        return locale.localized("\(deadline) · \(progress.completed) de \(progress.total)")
    }

    /// Versão para leitura em voz alta: "Termina domingo, 2 de 5 tarefas feitas".
    func cycleStatusSpoken(periodEnd: Date, progress: CycleProgress, now: Date) -> String {
        locale.localized("\(houseText.deadline(cycleEnd: periodEnd, now: now)), \(HouseOverviewText.progress(progress, locale: locale))")
    }

    /// "Hoje", "Amanhã", dia da semana (até uma semana) ou dia e mês; prazo vencido vira "Atrasada".
    func dueDay(_ due: Date, now: Date) -> String {

        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: due)
        ).day ?? 0

        switch days {
        case ..<0:
            return locale.localized("Atrasada")
        case 0:
            return locale.localized("Hoje")
        case 1:
            return locale.localized("Amanhã")
        case 2..<HouseOverviewText.weekdayHorizonInDays:
            return due.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                    .weekday(.wide)
            )
            .localizedCapitalized
        default:
            return due.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                    .day()
                    .month(.abbreviated)
            )
        }
    }
}
