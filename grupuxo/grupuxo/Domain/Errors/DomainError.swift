import Foundation

enum DomainError: Error, LocalizedError, Equatable, Sendable {
    case entityNotFound
    case invalidDateInterval
    case invalidTaskName
    case invalidTaskKind
    case roomNotFound
    case taskAlreadyCompleted
    case taskUnavailable

    var errorDescription: String? {
        switch self {
        case .entityNotFound: "Item não encontrado."
        case .invalidDateInterval: "O período informado é inválido."
        case .invalidTaskName: "Informe um nome para a tarefa."
        case .invalidTaskKind: "Tipo de Tarefa selecionado não disponível"
        case .roomNotFound: "Cômodo não encontrado na casa"
        case .taskAlreadyCompleted: "Esta tarefa já foi concluída."
        case .taskUnavailable: "Esta tarefa não está disponível."
        }
    }
}
