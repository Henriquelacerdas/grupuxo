import Foundation
import GrupuxoDomain
import SwiftUI

/// Textos dos níveis e das tags da avaliação (frases completas no catálogo; sem estrelas nem pontuação).
enum WeekRatingText {

    static func title(_ level: RatingLevel) -> String {
        switch level {
        case .needsWork: String(localized: "Precisa melhorar")
        case .good: String(localized: "Bom")
        case .great: String(localized: "Ótimo")
        }
    }

    /// Pergunta acima das tags: elogio para bom e ótimo, melhoria para "precisa melhorar".
    static func tagsQuestion(for level: RatingLevel) -> LocalizedStringKey {
        level == .needsWork ? "O que pode melhorar? (opcional)" : "O que foi bom? (opcional)"
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
        case .spotless: String(localized: "Bem limpo")
        case .tidy: String(localized: "Organizado")
        case .onTime: String(localized: "No prazo")
        case .careful: String(localized: "Caprichado")
        case .notCleaned: String(localized: "Faltou limpar")
        case .messy: String(localized: "Ficou bagunçado")
        case .halfDone: String(localized: "Ficou pela metade")
        case .tookTooLong: String(localized: "Demorou para ficar pronto")
        }
    }

    /// "Termina terça": o último dia para avaliar (a janela fecha à meia-noite do dia seguinte).
    static func closing(_ windowEnd: Date, calendar: Calendar = .current) -> String {
        let lastDay = calendar.date(byAdding: .day, value: -1, to: windowEnd) ?? windowEnd
        let weekday = lastDay.formatted(.dateTime.weekday(.wide).locale(HouseOverviewText.appLocale))
        return String(localized: "Termina \(weekday)")
    }
}
