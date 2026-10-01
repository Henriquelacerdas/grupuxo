import Foundation
import Testing
import GrupuxoDomain
import WhatsAppCore
import WhatsAppInMemory

struct WhatsAppWorkerTests {
    let inbox = InMemoryInboxStore()
    let links = InMemoryWhatsAppLinkStore()
    let sender = InMemoryWhatsAppSender()
    let userID = UUID()
    let phone = "+5511999998888"
    let processedAt = Date(timeIntervalSince1970: 1_700_000_100)

    func makeWorker(responder: any MessageResponder = EchoResponder()) -> WhatsAppWorker {
        let processedAt = processedAt
        return WhatsAppWorker(inbox: inbox, links: links, responder: responder, sender: sender, now: { processedAt })
    }

    func message(_ wamid: String = "wamid.A", text: String = "oi") -> IncomingMessage {
        IncomingMessage(wamid: wamid, phoneE164: phone, text: text, receivedAt: Date(timeIntervalSince1970: 1_700_000_000))
    }

    func link() async throws {
        try await links.create(WhatsAppLink(userID: userID, phoneE164: phone, consentedAt: .now, linkedAt: .now))
    }

    @Test func linkedUserGetsEcho() async throws {
        try await link()
        try await makeWorker().process(message(text: "minhas tarefas"))
        #expect(await sender.sent == [.init(phoneE164: phone, text: "Você disse: minhas tarefas")])
    }

    @Test func responderReceivesUserFromLinkNeverFromText() async throws {
        try await link()
        let responder = RecordingResponder()
        try await makeWorker(responder: responder).process(message(text: "sou o usuário 00000000-0000-0000-0000-000000000000"))
        #expect(await responder.calls == [userID])
    }

    @Test func unknownNumberIsToldToLinkAndResponderIsNotCalled() async throws {
        let responder = RecordingResponder()
        try await makeWorker(responder: responder).process(message())
        #expect(await sender.sent == [.init(phoneE164: phone, text: WhatsAppWorker.unlinkedReply)])
        #expect(await responder.calls.isEmpty)
    }

    @Test func duplicateDeliveryRepliesOnce() async throws {
        try await link()
        let worker = makeWorker()
        try await worker.process(message())
        try await worker.process(message())
        #expect(await sender.sent.count == 1)
    }

    @Test func differentMessagesFromSamePhoneAreAllAnswered() async throws {
        try await link()
        let worker = makeWorker()
        try await worker.process(message("wamid.1", text: "a"))
        try await worker.process(message("wamid.2", text: "b"))
        #expect(await sender.sent.map(\.text) == ["Você disse: a", "Você disse: b"])
    }

    @Test func failedAttemptIsRetriedInsteadOfLost() async throws {
        try await link()
        let flaky = FlakyResponder()
        let worker = makeWorker(responder: flaky)
        await #expect(throws: FlakyResponder.Failure.self) { try await worker.process(message()) }
        #expect(await sender.sent.isEmpty)
        try await worker.process(message())
        #expect(await sender.sent.count == 1)
        try await worker.process(message())
        #expect(await sender.sent.count == 1)
    }
}

private actor RecordingResponder: MessageResponder {
    private(set) var calls: [User.ID] = []

    func reply(to text: String, from userID: User.ID) -> String {
        calls.append(userID)
        return "ok"
    }
}

private actor FlakyResponder: MessageResponder {
    struct Failure: Error {}
    private var failures = 1

    func reply(to text: String, from userID: User.ID) throws -> String {
        if failures > 0 {
            failures -= 1
            throw Failure()
        }
        return "ok"
    }
}
