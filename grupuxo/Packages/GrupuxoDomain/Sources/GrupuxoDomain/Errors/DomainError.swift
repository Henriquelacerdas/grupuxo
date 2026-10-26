import Foundation

public enum DomainError: Error, LocalizedError, Equatable, Sendable {
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
    case roomAccessNotRequestable

    /// Mensagens em português; a tradução vem do `Localizable.xcstrings` do app (`String(localized:)` busca no bundle principal).
    /// Fora do app (`swift test`), não há catálogo e volta o texto em português.
    public var errorDescription: String? {

        switch self {
        case .deletionConfirmationRequired: String(localized: "Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.")
        case .wholeHouseProtected: String(localized: "Casa toda sempre inclui todos os moradores e não permite saída individual nem exclusão.")
        case .invalidDistribution: String(localized: "A distribuição de tarefas é inválida.")
        case .noEligibleMembers: String(localized: "O cômodo não possui participantes elegíveis.")
        case .invalidSchedule: String(localized: "A periodicidade e a política da tarefa são incompatíveis.")
        case .entityNotFound:
            String(localized: "Item não encontrado.")

        case .invalidDateInterval:
            String(localized: "O período informado é inválido.")

        case .invalidTaskName:
            String(localized: "Informe um nome para a tarefa.")

        case .invalidResidentName: String(localized: "Informe o nome do morador.")
        case .cannotRemoveCurrentUser: String(localized: "Você não pode remover seu próprio perfil da casa.")

        case .invalidRoomName:
            String(localized: "Informe um nome para o cômodo.")

        case .invalidRoomParticipants:
            String(localized: "O cômodo precisa ter participantes válidos.")

        case .taskAlreadyCompleted:
            String(localized: "Esta tarefa já foi concluída.")

        case .taskUnavailable:
            String(localized: "Esta tarefa não está disponível.")

        case .roomAccessNotRequestable:
            String(localized: "Só é possível pedir para entrar em cômodos privados de que você não participa.")
        }
    }
}
