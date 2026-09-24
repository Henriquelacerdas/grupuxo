import Foundation

enum DomainError: Error, LocalizedError, Equatable, Sendable {
    case deletionConfirmationRequired
    case wholeHouseProtected
    case invalidDistribution
    case noEligibleMembers
    case invalidSchedule
    case entityNotFound
    case invalidDateInterval
    case invalidTaskName
    case invalidResidentName
    case cannotRemoveCurrentUser
    case invalidRoomName
    case invalidRoomParticipants
    case taskAlreadyCompleted
    case taskUnavailable

    var errorDescription: String? {

        switch self {
        case .deletionConfirmationRequired: "Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos."
        case .wholeHouseProtected: "Casa toda sempre inclui todos os moradores e não permite saída individual nem exclusão."
        case .invalidDistribution: "A distribuição de tarefas é inválida."
        case .noEligibleMembers: "O cômodo não possui participantes elegíveis."
        case .invalidSchedule: "A periodicidade e a política da tarefa são incompatíveis."
        case .entityNotFound:
            "Item não encontrado."

        case .invalidDateInterval:
            "O período informado é inválido."

        case .invalidTaskName:
            "Informe um nome para a tarefa."

        case .invalidResidentName: "Informe o nome do morador."
        case .cannotRemoveCurrentUser: "Você não pode remover seu próprio perfil da casa."

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
