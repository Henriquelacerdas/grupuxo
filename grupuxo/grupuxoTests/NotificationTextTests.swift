import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

struct NotificationTextTests {

    private let marina = UUID()
    private let leo = UUID()
    private var names: [User.ID: String] { [marina: "Marina Souza", leo: "Leo"] }

    private func notice(
        _ kind: AppNotificationKind, actor: UUID? = nil, subject: String? = nil,
        task: UUID? = nil, room: UUID? = nil
    ) -> AppNotification {
        AppNotification(
            id: UUID(), recipientUserID: leo, kind: kind, taskDefinitionID: task, roomID: room,
            actorUserID: actor, subjectName: subject, createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test func messagesNameWhoDidWhatWithTheNameOfThen() {
        let text = { (notification: AppNotification) in NotificationText.message(for: notification, memberNames: names) }
        #expect(text(notice(.taskEdited, actor: marina, subject: "Louça")) == "Marina S. editou a tarefa Louça.")
        #expect(text(notice(.taskDeleted, actor: marina, subject: "Louça")) == "Marina S. apagou a tarefa Louça.")
        #expect(text(notice(.effortChanged, actor: marina, subject: "Louça")) == "Marina S. mudou o esforço de Louça.")
        #expect(text(notice(.memberJoined, actor: marina, subject: "Marina Souza")) == "Marina Souza entrou na casa.")
        #expect(text(notice(.memberLeft, actor: marina, subject: "Marina Souza")) == "Marina Souza saiu da casa.")
    }

    @Test func theTwoLinesFollowTheFigma() {
        let sunday = Date(timeIntervalSince1970: 1_793_000_000) // um instante qualquer: só conferimos que o dia aparece
        let accepted = AppNotification(
            id: UUID(), recipientUserID: leo, kind: .taskSwapAccepted, actorUserID: marina, taskName: "Limpar a pia",
            dueAt: sunday, createdAt: .now
        )
        let acceptedLines = NotificationText.lines(for: accepted, memberNames: names)
        #expect(acceptedLines.title == "Marina S. aceitou a troca")
        #expect(acceptedLines.detail?.hasPrefix("Você faz Limpar a pia até ") == true)

        let deleted = AppNotification(
            id: UUID(), recipientUserID: leo, kind: .taskDeleted, actorUserID: marina, subjectName: "Limpar forno",
            roomName: "Cozinha", createdAt: .now
        )
        let deletedLines = NotificationText.lines(for: deleted, memberNames: names)
        #expect(deletedLines.title == "Marina S. apagou uma tarefa")
        #expect(deletedLines.detail == "Limpar forno · Cozinha")

        let effort = AppNotification(
            id: UUID(), recipientUserID: leo, kind: .effortChanged, actorUserID: marina, subjectName: "Varrer o chão",
            effortFrom: 1, effortTo: 2, createdAt: .now
        )
        let effortLines = NotificationText.lines(for: effort, memberNames: names)
        #expect(effortLines.title == "Marina S. mudou o esforço")
        #expect(effortLines.detail == "Varrer o chão: Leve → Médio")

        let cycle = AppNotification(
            id: UUID(), recipientUserID: leo, kind: .cycleTurned, subjectName: "Cozinha", dueAt: sunday, names: ["Marina Souza"],
            createdAt: .now
        )
        let cycleLines = NotificationText.lines(for: cycle, memberNames: names)
        #expect(cycleLines.title == "Novo ciclo: Cozinha")
        #expect(cycleLines.detail?.hasPrefix("Você e Marina S. até ") == true)

        let summary = NotificationText.lines(for: notice(.weeklySummaryReady), memberNames: names)
        #expect(summary.title == "Resumo da semana pronto" && summary.detail == "Veja como ficaram os cômodos.")

        let oneLine = NotificationText.lines(for: notice(.memberJoined, subject: "Vidal"), memberNames: names)
        #expect(oneLine.title == "Vidal entrou na casa." && oneLine.detail == nil, "o que o Figma não detalha fica numa linha")
    }

    @Test func anUnknownActorIsSomeoneAndAMissingSubjectFallsBack() {
        let stranger = notice(.taskEdited, actor: UUID(), subject: "Louça")
        #expect(NotificationText.message(for: stranger, memberNames: names) == "Alguém editou a tarefa Louça.")
        let bare = notice(.taskEdited)
        #expect(NotificationText.message(for: bare, memberNames: names) == "Uma tarefa foi editada.")
    }

    @Test func aReadyMadeMessageWinsAndEveryKindHasAnIconAndATint() {
        let mock = AppNotification(
            id: UUID(), recipientUserID: leo, kind: .taskEdited, message: "Pronto.", createdAt: .now
        )
        #expect(NotificationText.message(for: mock, memberNames: [:]) == "Pronto.")
        for kind in [AppNotificationKind.taskSwapRequested, .taskSwapAccepted, .taskSwapRejected, .taskEdited, .taskDeleted,
                     .effortChanged, .memberJoined, .memberLeft, .roomDeleted, .roomAccessRequested, .roomAccessApproved,
                     .roomAccessDenied, .cycleTurned, .weeklySummaryReady] {
            #expect(!NotificationText.iconName(for: kind).isEmpty)
            _ = NotificationText.tint(for: kind)
            #expect(!NotificationText.message(for: notice(kind), memberNames: [:]).isEmpty)
        }
    }

    @Test func onlyNoticesThatPointToSomethingAliveOpenIt() {
        let task = UUID(), room = UUID()
        #expect(NotificationText.target(for: notice(.taskEdited, task: task)) == .task(task))
        #expect(NotificationText.target(for: notice(.effortChanged, task: task)) == .task(task))
        #expect(NotificationText.target(for: notice(.roomAccessRequested, room: room)) == .room(room))
        #expect(NotificationText.target(for: notice(.taskDeleted, task: task)) == nil, "a tarefa apagada não existe mais")
        #expect(NotificationText.target(for: notice(.memberLeft)) == nil)
    }

    @Test func theListSkipsNoticesOfKindsThisAppDoesNotKnow() throws {
        let json = """
        {"notifications":[
          {"id":"ffffffff-ffff-4fff-8fff-000000000001","kind":"taskEdited","swapRequestID":null,"taskDefinitionID":"ffffffff-ffff-4fff-8fff-000000000002",
           "roomID":null,"actorUserID":null,"subjectName":"Louça","createdAt":"2026-10-14T12:00:00.000Z","readAt":null},
          {"id":"ffffffff-ffff-4fff-8fff-000000000003","kind":"kindFromTheFuture","swapRequestID":null,"taskDefinitionID":null,
           "roomID":null,"actorUserID":null,"subjectName":null,"createdAt":"2026-10-14T12:00:00.000Z","readAt":null},
          {"id":"ffffffff-ffff-4fff-8fff-000000000004","kind":"taskSwapRequested","swapRequestID":"ffffffff-ffff-4fff-8fff-000000000005",
           "createdAt":"2026-10-14T12:00:00.000Z","readAt":null}
        ]}
        """
        let list = try APIClient.makeDecoder().decode(NotificationListDTO.self, from: Data(json.utf8))
        #expect(list.notifications.map(\.kind) == [.taskEdited, .taskSwapRequested])
        #expect(list.notifications.first?.subjectName == "Louça")
    }
}
