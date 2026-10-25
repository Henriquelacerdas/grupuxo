import Foundation
import GrupuxoDomain

/// Textos das linhas da tela do cômodo.
enum RoomDetailText {

    /// "Leve", "Médio" ou "Intenso": o esforço é carga interna, nunca pontuação.
    static func effort(_ effort: TaskEffort) -> String {

        switch TaskEffortLevel(rawValue: effort.points) {
        case .light: "Leve"
        case .medium: "Médio"
        default: "Intenso"
        }
    }

    /// "A cada 15 dias", "A cada 1 mês"; sem repetição, `nil`.
    static func recurrence(_ recurrence: RecurrencePolicy) -> String? {

        switch recurrence {

        case .none:
            return nil

        case let .recurring(frequency, interval):

            let unit: String

            switch frequency {
            case .daily: unit = interval == 1 ? "dia" : "dias"
            case .weekly: unit = interval == 1 ? "semana" : "semanas"
            case .monthly: unit = interval == 1 ? "mês" : "meses"
            case .yearly: unit = interval == 1 ? "ano" : "anos"
            }

            return "A cada \(interval) \(unit)"

        case let .weekly(periodicity):

            return "A cada \(periodicity.intervalWeeks) "
                + (periodicity.intervalWeeks == 1 ? "semana" : "semanas")
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

        return "\(recurrence) · \(effort)"
    }

    /// Situação de uma tarefa única: de quem é, ou que ninguém pegou ainda.
    static func singleTaskStatus(_ item: TaskItem, currentUserID: User.ID) -> String {

        if item.occurrence.isCompleted { return "Concluída" }

        guard let assignment = item.assignment else { return "Ninguém pegou ainda" }

        if assignment.userID == currentUserID { return "Com você" }

        if let assignee = item.assignee {
            return "Com \(ResidentNameFormatting.shortName(assignee.name))"
        }

        return "Já tem responsável"
    }

    /// Duração do ciclo do cômodo, com os nomes que o formulário de criação usa:
    /// 1 semana é "Semanal", 2 "Quinzenal", 4 "Mensal"; o resto vira "A cada N semanas".
    static func cycleDuration(_ periodicity: WeeklyPeriodicity) -> String {

        switch periodicity.intervalWeeks {
        case 1: "Semanal"
        case 2: "Quinzenal"
        case 4: "Mensal"
        default: "A cada \(periodicity.intervalWeeks) semanas"
        }
    }

    /// "Todos • público" ou, num cômodo privado, "2 moradores • privado".
    static func participants(of room: Room, memberCount: Int) -> String {

        switch room.visibility {

        case .common:
            return "Todos • público"

        case .privateRoom:
            let people = memberCount == 1 ? "1 morador" : "\(memberCount) moradores"
            return "\(people) • privado"
        }
    }
}
