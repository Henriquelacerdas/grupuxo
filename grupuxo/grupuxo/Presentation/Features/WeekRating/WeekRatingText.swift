import Foundation
import GrupuxoDomain

/// Textos dos níveis e das tags da avaliação (frases completas no catálogo; sem estrelas nem pontuação).
enum WeekRatingText {

    static func title(_ level: RatingLevel) -> String {
        switch level {
        case .needsWork: String(localized: "Precisa melhorar")
        case .good: String(localized: "Bom")
        case .great: String(localized: "Ótimo")
        }
    }

    static func systemImage(_ level: RatingLevel) -> String {
        switch level {
        case .needsWork: "hand.thumbsdown"
        case .good: "hand.thumbsup"
        case .great: "sparkles"
        }
    }

    static func title(_ tag: RatingTag) -> String {
        switch tag {
        case .wellDone: String(localized: "Bem feito")
        case .onTime: String(localized: "No prazo")
        case .tidy: String(localized: "Organizado")
        case .wentTheExtraMile: String(localized: "Foi além")
        case .rushed: String(localized: "Meio às pressas")
        case .late: String(localized: "Atrasou")
        case .missedSpots: String(localized: "Faltaram detalhes")
        }
    }

    /// "Termina terça": o último dia para avaliar (a janela fecha à meia-noite do dia seguinte).
    static func closing(_ windowEnd: Date, calendar: Calendar = .current) -> String {
        let lastDay = calendar.date(byAdding: .day, value: -1, to: windowEnd) ?? windowEnd
        let weekday = lastDay.formatted(.dateTime.weekday(.wide).locale(HouseOverviewText.appLocale))
        return String(localized: "Termina \(weekday)")
    }
}
