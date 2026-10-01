import Foundation
import Testing
import WhatsAppCore
import WhatsAppInMemory

struct WebhookHandlerTests {
    let queue = InMemoryMessageQueue()
    let fallbackDate = Date(timeIntervalSince1970: 1_800_000_000)

    func makeHandler(queue: (any MessageQueue)? = nil) -> WebhookHandler {
        let fallback = fallbackDate
        return WebhookHandler(
            config: WebhookConfig(verifyToken: Fixtures.verifyToken, appSecret: Fixtures.appSecret),
            queue: queue ?? self.queue,
            now: { fallback }
        )
    }

    func get(_ parameters: [String: String]) -> WebhookRequest {
        WebhookRequest(method: "GET", queryParameters: parameters)
    }

    // MARK: Verificação (GET)

    @Test func verificationEchoesChallenge() async {
        let response = await makeHandler().handle(get([
            "hub.mode": "subscribe", "hub.verify_token": Fixtures.verifyToken, "hub.challenge": "1158201444"
        ]))
        #expect(response == WebhookResponse(statusCode: 200, body: "1158201444"))
    }

    @Test func verificationRejectsWrongTokenModeOrMissingParameters() async {
        let handler = makeHandler()
        let invalid: [[String: String]] = [
            ["hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "1"],
            ["hub.mode": "unsubscribe", "hub.verify_token": Fixtures.verifyToken, "hub.challenge": "1"],
            ["hub.verify_token": Fixtures.verifyToken, "hub.challenge": "1"],
            ["hub.mode": "subscribe", "hub.challenge": "1"],
            ["hub.mode": "subscribe", "hub.verify_token": Fixtures.verifyToken],
            [:]
        ]
        for parameters in invalid {
            #expect(await handler.handle(get(parameters)).statusCode == 403)
        }
    }

    @Test func verificationFailsClosedWithEmptyConfiguredToken() async {
        let handler = WebhookHandler(config: WebhookConfig(verifyToken: "", appSecret: Fixtures.appSecret), queue: queue)
        let response = await handler.handle(get(["hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1"]))
        #expect(response.statusCode == 403)
    }

    // MARK: Eventos (POST)

    @Test func validTextEventIsEnqueuedAndAcknowledged() async {
        let body = Fixtures.textEvent()
        let response = await makeHandler().handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(response.statusCode == 200)
        #expect(await queue.drain() == [
            IncomingMessage(wamid: "wamid.A", phoneE164: "+5511999998888", text: "quais são minhas tarefas?", receivedAt: Date(timeIntervalSince1970: 1_700_000_000))
        ])
    }

    @Test func headerLookupIsCaseInsensitive() async {
        let body = Fixtures.textEvent()
        let request = WebhookRequest(method: "post", headers: ["X-Hub-Signature-256": Fixtures.sign(body)], body: body)
        #expect(await makeHandler().handle(request).statusCode == 200)
        #expect(await queue.drain().count == 1)
    }

    @Test func invalidOrMissingSignatureIsRejectedWithoutEnqueueing() async {
        let body = Fixtures.textEvent()
        let handler = makeHandler()
        #expect(await handler.handle(Fixtures.request(body: body, signature: nil)).statusCode == 401)
        #expect(await handler.handle(Fixtures.request(body: body, signature: Fixtures.sign(body, secret: "outro"))).statusCode == 401)
        #expect(await handler.handle(Fixtures.request(body: body, signature: Fixtures.sign(Fixtures.textEvent(body: "outra")))).statusCode == 401)
        #expect(await queue.drain().isEmpty)
    }

    @Test func statusEventsAreAcknowledgedButIgnored() async {
        let body = Fixtures.payload(statuses: #"[{"id":"wamid.X","status":"delivered","timestamp":"1700000001","recipient_id":"5511999998888"}]"#)
        let response = await makeHandler().handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(response.statusCode == 200)
        #expect(await queue.drain().isEmpty)
    }

    @Test func nonTextMessagesAndForeignObjectsAreIgnored() async {
        let image = Fixtures.payload(messages: #"[{"from":"5511999998888","id":"wamid.I","timestamp":"1700000000","type":"image","image":{"id":"1","mime_type":"image/jpeg"}}]"#)
        let foreign = Fixtures.textEvent().replacingObject("whatsapp_business_account", with: "instagram")
        let otherField = Fixtures.payload(messages: #"[{"from":"5511999998888","id":"wamid.F","timestamp":"1700000000","type":"text","text":{"body":"oi"}}]"#, field: "account_update")
        let handler = makeHandler()
        for body in [image, foreign, otherField] {
            #expect(await handler.handle(Fixtures.request(body: body, signature: Fixtures.sign(body))).statusCode == 200)
        }
        #expect(await queue.drain().isEmpty)
    }

    @Test func batchedMessagesKeepOrder() async {
        let body = Fixtures.payload(messages: """
        [{"from":"5511999998888","id":"wamid.1","timestamp":"1700000000","type":"text","text":{"body":"um"}},
         {"from":"5511999998888","id":"wamid.2","timestamp":"1700000001","type":"image","image":{"id":"1"}},
         {"from":"5521988887777","id":"wamid.3","timestamp":"1700000002","type":"text","text":{"body":"três"}}]
        """)
        _ = await makeHandler().handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(await queue.drain().map(\.wamid) == ["wamid.1", "wamid.3"])
    }

    @Test func missingTimestampFallsBackToClock() async {
        let body = Fixtures.payload(messages: #"[{"from":"5511999998888","id":"wamid.T","type":"text","text":{"body":"oi"}}]"#)
        _ = await makeHandler().handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(await queue.drain().first?.receivedAt == fallbackDate)
    }

    @Test func malformedJSONWithValidSignatureIsBadRequest() async {
        let body = Data("não é json".utf8)
        let response = await makeHandler().handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(response.statusCode == 400)
    }

    @Test func queueFailureReturns500SoMetaRetries() async {
        let body = Fixtures.textEvent()
        let response = await makeHandler(queue: FailingQueue()).handle(Fixtures.request(body: body, signature: Fixtures.sign(body)))
        #expect(response.statusCode == 500)
    }

    @Test func unsupportedMethodIs405() async {
        #expect(await makeHandler().handle(WebhookRequest(method: "PUT")).statusCode == 405)
    }

    @Test func messageSurvivesQueueSerialization() throws {
        let message = IncomingMessage(wamid: "wamid.A", phoneE164: "+5511999998888", text: "oi", receivedAt: Date(timeIntervalSince1970: 1_700_000_000))
        let decoded = try JSONDecoder().decode(IncomingMessage.self, from: JSONEncoder().encode(message))
        #expect(decoded == message)
    }
}

private struct FailingQueue: MessageQueue {
    struct Failure: Error {}
    func enqueue(_ message: IncomingMessage) async throws { throw Failure() }
}

private extension Data {
    func replacingObject(_ old: String, with new: String) -> Data {
        Data(String(decoding: self, as: UTF8.self).replacingOccurrences(of: "\"\(old)\"", with: "\"\(new)\"").utf8)
    }
}
