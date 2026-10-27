import Foundation
import GrupuxoDomain

/// Textos das linhas da tela do cômodo.
enum RoomDetailText {

    /// "Leve", "Médio" ou "Intenso": o esforço é carga interna, nunca pontuação.
    static func effort(_ effort: TaskEffort) -> String {

        switch TaskEffortLevel(rawValue: effort.points) {
        case .light: String(localized: "Leve")
        case .medium: String(localized: "Médio")
        default: String(localized: "Intenso")
        }
    }

    /// "A cada 15 dias", "A cada 1 mês"; sem repetição, `nil`.
    static func recurrence(_ recurrence: RecurrencePolicy) -> String? {

        switch recurrence {

        case .none:
            return nil

        case let .recurring(frequency, interval):

            // Singular e plural ficam nas variações do catálogo.
            switch frequency {
            case .daily: return String(localized: "A cada \(interval) dias")
            case .weekly: return String(localized: "A cada \(interval) semanas")
            case .monthly: return String(localized: "A cada \(interval) meses")
            case .yearly: return String(localized: "A cada \(interval) anos")
            }

        case let .weekly(periodicity):

            return String(localized: "A cada \(periodicity.intervalWeeks) semanas")
        }
    }

    /// Linha de apoio de uma tarefa recorrente: "A cada 15 dias · Intenso" ou só o esforço.
    static func subtitle(
        for definition: TaskDefinition,
        includingRecurrence: Bool
    ) -> String {

        let effort = effort(definition.effort)

        guard includingRecurrence,
              let recurrence = recurrence(definition.recurrence)
        else { return effort }

        return String(localized: "\(recurrence) · \(effort)")
    }

    /// Situação de uma tarefa única: de quem é, ou que ninguém pegou ainda.
    static func singleTaskStatus(_ item: TaskItem, currentUserID: User.ID) -> String {

        if item.occurrence.isCompleted { return String(localized: "Concluída") }

        guard let assignment = item.assignment else { return String(localized: "Ninguém pegou ainda") }

        if assignment.userID == currentUserID { return String(localized: "Com você") }

        if let assignee = item.assignee {
            return String(localized: "Com \(ResidentNameFormatting.shortName(assignee.name))")
        }

        return String(localized: "Já tem responsável")
    }

    /// Duração do ciclo do cômodo, com os nomes que o formulário de criação usa:
    /// 1 semana é "Semanal", 2 "Quinzenal", 4 "Mensal"; o resto vira "A cada N semanas".
    static func cycleDuration(_ periodicity: WeeklyPeriodicity) -> String {

        switch periodicity.intervalWeeks {
        case 1: String(localized: "Semanal")
        case 2: String(localized: "Quinzenal")
        case 4: String(localized: "Mensal")
        default: String(localized: "A cada \(periodicity.intervalWeeks) semanas")
        }
    }

    /// "Todos • público" ou, num cômodo privado, "2 moradores • privado".
    static func participants(of room: Room, memberCount: Int) -> String {

        switch room.visibility {

        case .common:
            return String(localized: "Todos • público")

        case .privateRoom:
            return String(localized: "\(memberCount) moradores • privado")
        }
    }
}
