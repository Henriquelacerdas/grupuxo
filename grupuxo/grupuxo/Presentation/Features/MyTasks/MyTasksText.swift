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

    /// Quando a vez ainda não começou: "Começa terça". Senão, o prazo: "Termina hoje", "Termina sexta-feira";
    /// prazo vencido vira "Terminou ontem" e é destacado. Sem prazo nem início futuro, nada.
    func timing(availableAt: Date, dueAt: Date?, now: Date) -> TaskTiming? {

        let startDays = days(from: now, to: availableAt)

        if startDays > 0 {
            return TaskTiming(
                text: locale.localized("Começa \(relativeDay(availableAt, days: startDays))"),
                style: .upcoming
            )
        }

        guard let dueAt else { return nil }

        let dueDays = days(from: now, to: dueAt)

        switch dueDays {
        case ..<0:
            return TaskTiming(
                text: locale.localized("Terminou \(relativeDay(dueAt, days: dueDays))"),
                style: .overdue
            )
        case 0:
            return TaskTiming(text: locale.localized("Termina hoje"), style: .due)
        default:
            return TaskTiming(
                text: locale.localized("Termina \(relativeDay(dueAt, days: dueDays))"),
                style: dueDays == 1 ? .due : .open
            )
        }
    }

    /// "Troca pedida · aguardando Henrique L."; sem o nome de quem recebe, só "Troca pedida".
    func pendingSwap(receiverName: String?) -> String {
        guard let receiverName, !receiverName.isEmpty else { return locale.localized("Troca pedida") }
        return locale.localized("Troca pedida · aguardando \(receiverName)")
    }

    /// Dias de calendário entre o dia de `now` e o de `date` (negativo no passado).
    private func days(from now: Date, to date: Date) -> Int {
        calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: date)
        ).day ?? 0
    }

    /// "amanhã", "ontem", dia da semana (até uma semana) ou dia e mês, para compor com "Começa"/"Termina"/"Terminou".
    private func relativeDay(_ date: Date, days: Int) -> String {

        switch days {
        case 1:
            return locale.localized("amanhã")
        case -1:
            return locale.localized("ontem")
        case -(HouseOverviewText.weekdayHorizonInDays - 1)...(HouseOverviewText.weekdayHorizonInDays - 1):
            return houseText.weekday(of: date)
        default:
            return date.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                    .day()
                    .month(.abbreviated)
            )
        }
    }
}

/// Início ou prazo de uma tarefa, como aparece na linha: o estilo decide o destaque.
struct TaskTiming: Equatable {

    enum Style: Equatable {
        /// Ainda não começou: texto discreto.
        case upcoming
        /// Prazo em aberto com mais de um dia pela frente: texto normal.
        case open
        /// Falta um dia ou menos: em negrito ao lado do cômodo.
        case due
        /// Prazo vencido: em vermelho.
        case overdue
    }

    let text: String
    let style: Style
}
