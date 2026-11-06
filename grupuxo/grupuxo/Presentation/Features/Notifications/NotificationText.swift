import Foundation
import GrupuxoDomain

/// Texto, ícone e destino de cada aviso. O servidor manda dados (tipo, quem fez, nome do assunto) e o app monta a
/// frase no idioma do aparelho; o nome do assunto é como era na hora, porque a tarefa ou o morador pode ter saído.
enum NotificationText {

    enum Tint: Equatable {
        case accent, orange, green, gray, red, blue
    }

    /// Para onde o toque leva, quando o aviso aponta para algo que ainda existe.
    enum Target: Equatable {
        case task(TaskDefinition.ID)
        case room(Room.ID)
    }

    static func message(for notification: AppNotification, memberNames: [User.ID: String]) -> String {

        if let message = notification.message { return message }

        let actor = actorName(notification, memberNames: memberNames)
        let subject = notification.subjectName ?? ""

        switch notification.kind {
        case .taskSwapRequested:
            return String(localized: "Você recebeu uma solicitação de troca de tarefa.")
        case .taskSwapAccepted:
            return String(localized: "Sua solicitação de troca de tarefa foi aceita.")
        case .taskSwapRejected:
            return String(localized: "Sua solicitação de troca de tarefa foi recusada.")
        case .taskEdited:
            return subject.isEmpty
                ? String(localized: "Uma tarefa foi editada.")
                : String(localized: "\(actor) editou a tarefa \(subject).")
        case .taskDeleted:
            return subject.isEmpty
                ? String(localized: "Uma tarefa foi apagada.")
                : String(localized: "\(actor) apagou a tarefa \(subject).")
        case .effortChanged:
            return subject.isEmpty
                ? String(localized: "O esforço de uma tarefa mudou.")
                : String(localized: "\(actor) mudou o esforço de \(subject).")
        case .memberJoined:
            return subject.isEmpty
                ? String(localized: "Alguém entrou na casa.")
                : String(localized: "\(subject) entrou na casa.")
        case .memberLeft:
            return subject.isEmpty
                ? String(localized: "Alguém saiu da casa.")
                : String(localized: "\(subject) saiu da casa.")
        case .roomDeleted:
            return subject.isEmpty
                ? String(localized: "Um cômodo foi excluído.")
                : String(localized: "\(actor) excluiu o cômodo \(subject).")
        case .roomAccessRequested:
            return subject.isEmpty
                ? String(localized: "\(actor) pediu para entrar em um cômodo.")
                : String(localized: "\(actor) pediu para entrar em \(subject).")
        case .roomAccessApproved:
            return subject.isEmpty
                ? String(localized: "Você entrou em um cômodo.")
                : String(localized: "Você entrou em \(subject).")
        case .roomAccessDenied:
            return subject.isEmpty
                ? String(localized: "Seu pedido para entrar em um cômodo foi recusado.")
                : String(localized: "Seu pedido para entrar em \(subject) foi recusado.")
        case .cycleTurned:
            return subject.isEmpty
                ? String(localized: "Um ciclo virou.")
                : String(localized: "O ciclo de \(subject) virou.")
        case .weeklySummaryReady:
            return String(localized: "O resumo da semana está pronto.")
        }
    }

    static func iconName(for kind: AppNotificationKind) -> String {
        switch kind {
        case .taskEdited: "pencil"
        case .taskDeleted: "trash"
        case .effortChanged: "bolt.fill"
        case .taskSwapRequested: "arrow.left.arrow.right"
        case .taskSwapAccepted: "checkmark"
        case .taskSwapRejected: "xmark"
        case .memberJoined: "person.badge.plus"
        case .memberLeft: "person.badge.minus"
        case .roomDeleted: "trash"
        case .roomAccessRequested: "lock.open"
        case .roomAccessApproved: "checkmark"
        case .roomAccessDenied: "xmark"
        case .cycleTurned: "arrow.triangle.2.circlepath"
        case .weeklySummaryReady: "list.bullet.clipboard.fill"
        }
    }

    static func tint(for kind: AppNotificationKind) -> Tint {
        switch kind {
        case .taskEdited, .effortChanged: .orange
        case .taskSwapRequested, .roomAccessRequested: .accent
        case .taskSwapAccepted, .roomAccessApproved, .memberJoined: .green
        case .taskSwapRejected, .roomAccessDenied, .memberLeft: .gray
        case .taskDeleted, .roomDeleted: .red
        case .cycleTurned, .weeklySummaryReady: .blue
        }
    }

    static func target(for notification: AppNotification) -> Target? {
        switch notification.kind {
        case .taskEdited, .effortChanged:
            return notification.taskDefinitionID.map(Target.task)
        case .roomAccessRequested, .roomAccessApproved, .cycleTurned:
            return notification.roomID.map(Target.room)
        default:
            return nil
        }
    }

    private static func actorName(_ notification: AppNotification, memberNames: [User.ID: String]) -> String {
        guard let id = notification.actorUserID, let name = memberNames[id], !name.isEmpty else {
            return String(localized: "Alguém")
        }
        return ResidentNameFormatting.shortName(name)
    }
}
