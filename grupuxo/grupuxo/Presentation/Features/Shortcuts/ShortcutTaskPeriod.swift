//
//  ShortcutTaskPeriod.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 04/11/26.
//


import AppIntents
import GrupuxoDomain

enum ShortcutTaskPeriod: String, AppEnum {

    case daily
    case weekly
    case biweekly
    case monthly
    case everyThreeMonths
    case everySixMonths
    case yearly

    static let typeDisplayRepresentation =
        TypeDisplayRepresentation(name: "Período")

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .daily: "Diariamente",
        .weekly: "Semanalmente",
        .biweekly: "Quinzenalmente",
        .monthly: "Mensalmente",
        .everyThreeMonths: "A cada 3 meses",
        .everySixMonths: "A cada 6 meses",
        .yearly: "Anualmente"
    ]

    var recurrence: RecurrencePolicy {
        switch self {          
        case .daily:
            .recurring(frequency: .daily, interval: 1)

        case .weekly:
            .recurring(frequency: .weekly, interval: 1)

        case .biweekly:
            .recurring(frequency: .weekly, interval: 2)

        case .monthly:
            .recurring(frequency: .monthly, interval: 1)

        case .everyThreeMonths:
            .recurring(frequency: .monthly, interval: 3)

        case .everySixMonths:
            .recurring(frequency: .monthly, interval: 6)

        case .yearly:
            .recurring(frequency: .yearly, interval: 1)
        }
    }
}
