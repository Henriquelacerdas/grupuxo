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

    /// As duas linhas do aviso (Figma "Notificações"): o que aconteceu e o detalhe. Os avisos que o Figma não detalha
    /// ficam numa linha só (a frase de `message`).
    static func lines(for notification: AppNotification, memberNames: [User.ID: String]) -> (title: String, detail: String?) {

        if notification.message != nil { return (message(for: notification, memberNames: memberNames), nil) }

        let actor = actorName(notification, memberNames: memberNames)
        let subject = notification.subjectName ?? ""
        let taskAndRoom = [subject, notification.roomName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")

        switch notification.kind {
        case .taskSwapAccepted:
            let detail = notification.taskName.map { task in
                notification.dueAt.map { String(localized: "Você faz \(task) até \(untilWeekday($0)).") }
                    ?? String(localized: "Você faz \(task).")
            }
            return (String(localized: "\(actor) aceitou a troca"), detail)
        case .taskSwapRejected:
            return (String(localized: "\(actor) recusou a troca"), nil)
        case .taskEdited where !subject.isEmpty:
            return (String(localized: "\(actor) editou uma tarefa"), taskAndRoom)
        case .taskDeleted where !subject.isEmpty:
            return (String(localized: "\(actor) apagou uma tarefa"), taskAndRoom)
        case .effortChanged where !subject.isEmpty:
            let detail: String
            if let from = notification.effortFrom, let to = notification.effortTo {
                detail = "\(subject): \(effortName(from)) → \(effortName(to))"
            } else {
                detail = taskAndRoom
            }
            return (String(localized: "\(actor) mudou o esforço"), detail)
        case .roomAccessRequested where !subject.isEmpty:
            return (String(localized: "\(actor) quer entrar em \(subject)"), String(localized: "Cômodo privado"))
        case .cycleTurned where !subject.isEmpty:
            let others = notification.names.map(ResidentNameFormatting.shortName)
            let who = ListFormatter.localizedString(byJoining: [String(localized: "Você")] + others)
            let detail = notification.dueAt.map { String(localized: "\(who) até \(untilWeekday($0))") }
            return (String(localized: "Novo ciclo: \(subject)"), detail)
        case .weeklySummaryReady:
            return (String(localized: "Resumo da semana pronto"), String(localized: "Veja como ficaram os cômodos."))
        default:
            return (message(for: notification, memberNames: memberNames), nil)
        }
    }

    /// "domingo": o último dia que vale (o prazo do ciclo é a meia-noite da segunda, então volta um segundo).
    private static func untilWeekday(_ due: Date) -> String {
        due.addingTimeInterval(-1).formatted(.dateTime.weekday(.wide).locale(HouseOverviewText.appLocale))
    }

    private static func effortName(_ points: Int) -> String {
        RoomDetailText.effort(TaskEffort(points: points))
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
