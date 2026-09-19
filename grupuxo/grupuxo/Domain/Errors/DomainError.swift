import Foundation

enum DomainError: Error, LocalizedError, Equatable, Sendable {

    case entityNotFound
    case invalidDateInterval
    case invalidTaskName
    case invalidRoomName
    case invalidRoomParticipants
    case taskAlreadyCompleted
    case taskUnavailable

    var errorDescription: String? {

        switch self {

        case .entityNotFound:
            "Item não encontrado."

        case .invalidDateInterval:
            "O período informado é inválido."

        case .invalidTaskName:
            "Informe um nome para a tarefa."

        case .invalidRoomName:
            "Informe um nome para o cômodo."

        case .invalidRoomParticipants:
            "O cômodo precisa ter participantes válidos."

        case .taskAlreadyCompleted:
            "Esta tarefa já foi concluída."

        case .taskUnavailable:
            "Esta tarefa não está disponível."
        }
    }
}
