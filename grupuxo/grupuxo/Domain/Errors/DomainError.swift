import Foundation

enum DomainError: Error, LocalizedError, Equatable, Sendable {
    case invalidDistribution
    case noEligibleMembers
    case invalidSchedule
    case entityNotFound
    case invalidDateInterval
    case invalidTaskName
    case taskAlreadyCompleted
    case taskUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidDistribution: "A distribuição de tarefas é inválida."
        case .noEligibleMembers: "O cômodo não possui participantes elegíveis."
        case .invalidSchedule: "A periodicidade e a política da tarefa são incompatíveis."
        case .entityNotFound: "Item não encontrado."
        case .invalidDateInterval: "O período informado é inválido."
        case .invalidTaskName: "Informe um nome para a tarefa."
        case .taskAlreadyCompleted: "Esta tarefa já foi concluída."
        case .taskUnavailable: "Esta tarefa não está disponível."
        }
    }
}
