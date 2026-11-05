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

            // Vocabulário de repetição da Apple; singular e plural ficam nas variações do catálogo.
            if interval == 1 {
                switch frequency {
                case .daily: return String(localized: "Diariamente")
                case .weekly: return String(localized: "Semanalmente")
                case .monthly: return String(localized: "Mensalmente")
                case .yearly: return String(localized: "Anualmente")
                }
            }

            switch frequency {
            case .daily: return String(localized: "A cada \(interval) dias")
            case .weekly: return String(localized: "A cada \(interval) semanas")
            case .monthly: return String(localized: "A cada \(interval) meses")
            case .yearly: return String(localized: "A cada \(interval) anos")
            }

        case let .weekly(periodicity):

            return periodicity.intervalWeeks == 1
                ? String(localized: "Semanalmente")
                : String(localized: "A cada \(periodicity.intervalWeeks) semanas")
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

    /// Periodicidade do ciclo do cômodo no vocabulário da Apple: 1 semana é "Semanalmente",
    /// 4 "Mensalmente"; o resto vira "A cada N semanas".
    static func cycleDuration(_ periodicity: WeeklyPeriodicity) -> String {

        switch periodicity.intervalWeeks {
        case 1: String(localized: "Semanalmente")
        case 4: String(localized: "Mensalmente")
        default: String(localized: "A cada \(periodicity.intervalWeeks) semanas")
        }
    }

    /// Subtítulo da tela do cômodo: "Rodízio semanal", "Rodízio mensal" ou "Rodízio a cada N semanas".
    static func rotation(_ periodicity: WeeklyPeriodicity) -> String {

        switch periodicity.intervalWeeks {
        case 1: String(localized: "Rodízio semanal")
        case 4: String(localized: "Rodízio mensal")
        default: String(localized: "Rodízio a cada \(periodicity.intervalWeeks) semanas")
        }
    }

    /// "4 pessoas": quantas participam do rodízio do cômodo (singular e plural no catálogo).
    static func people(_ count: Int) -> String {
        String(localized: "\(count) pessoas")
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
