import Foundation
import GrupuxoDomain

/// Textos da tela Casa. Calendário, localidade e relógio chegam por parâmetro, sem valores globais.
struct HouseOverviewText {

    /// Abaixo desta distância, em dias, o término aparece como dia da semana ("Termina domingo").
    static let weekdayHorizonInDays = 7

    /// Os textos do app são fixos em português; até existir catálogo de localização, datas e listas seguem o mesmo idioma.
    static let appLocale = Locale(identifier: "pt_BR")

    let calendar: Calendar
    let locale: Locale

    init(calendar: Calendar = .current, locale: Locale = HouseOverviewText.appLocale) {
        self.calendar = calendar
        self.locale = locale
    }

    /// "Você e Gabriel M.": o morador logado vira "Você" e vem primeiro; os demais, em nome curto.
    func responsibles(
        names: [String],
        userIDs: [User.ID],
        currentUserID: User.ID
    ) -> String? {

        guard !names.isEmpty, names.count == userIDs.count else { return nil }

        let pairs = zip(userIDs, names)

        let others = pairs
            .filter { $0.0 != currentUserID }
            .map { ResidentNameFormatting.shortName($0.1) }

        let isResponsible = userIDs.contains(currentUserID)
        let listed = (isResponsible ? [Self.you] : []) + others

        let formatter = ListFormatter()
        formatter.locale = locale

        return formatter.string(from: listed)
    }

    /// `end` é o fim exclusivo do ciclo: o último dia é o anterior.
    func deadline(cycleEnd end: Date, now: Date) -> String {

        let lastDay = calendar.date(byAdding: .day, value: -1, to: end) ?? end

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
            return "Termina hoje"
        case 1:
            return "Termina amanhã"
        case 2..<Self.weekdayHorizonInDays:
            return "Termina \(weekday(of: lastDay))"
        default:
            return "Termina em \(days) dias"
        }
    }

    static func progress(_ progress: CycleProgress) -> String {

        switch progress.total {
        case 0: "Nenhuma tarefa neste ciclo"
        case 1: "\(progress.completed) de 1 tarefa feita"
        default: "\(progress.completed) de \(progress.total) tarefas feitas"
        }
    }

    static let you = "Você"
    static let privateRoom = "Cômodo Privado"
    static let overflowTitle = "Outras"

    private func weekday(of date: Date) -> String {

        date.formatted(
            Date.FormatStyle(
                locale: locale,
                calendar: calendar,
                timeZone: calendar.timeZone
            )
            .weekday(.wide)
        )
    }
}
