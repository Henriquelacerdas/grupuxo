import Foundation
import Testing
import GrupuxoDomain
import WhatsAppCore
import WhatsAppInMemory

struct WhatsAppLinkerTests {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)
    static let token = String(repeating: "ab", count: 16)

    let tokens = InMemoryLinkTokenStore()
    let links = InMemoryWhatsAppLinkStore()
    let sender = InMemoryWhatsAppSender()
    let inbox = InMemoryInboxStore()
    let ana = UUID(), bia = UUID()
    let anaPhone = "+5511999998888"
    let biaPhone = "+5521988887777"
    let sentAt = Date(timeIntervalSince1970: 1_699_999_990)

    func makeLinker(at date: Date = now) throws -> WhatsAppLinker {
        WhatsAppLinker(
            config: try LinkConfig(botPhoneNumber: "+5511900000000"),
            tokens: tokens, links: links,
            now: { date },
            randomBytes: { count in Array(repeating: 0xab, count: count) }
        )
    }

    func makeWorker(linker: WhatsAppLinker, responder: any MessageResponder = EchoResponder()) -> WhatsAppWorker {
        WhatsAppWorker(inbox: inbox, links: links, linker: linker, responder: responder, sender: sender, now: { Self.now })
    }

    func message(_ wamid: String = "wamid.1", from phone: String? = nil, text: String? = nil) -> IncomingMessage {
        IncomingMessage(wamid: wamid, phoneE164: phone ?? anaPhone, text: text ?? "Conectar meu WhatsApp ao Grupuxo. Código: \(Self.token)", receivedAt: sentAt)
    }

    // MARK: convite

    @Test func invitationBuildsWaMeUrlWithEncodedMessage() async throws {
        let invitation = try await makeLinker().issueInvitation(for: ana)
        #expect(invitation.url == "https://wa.me/5511900000000?text=Conectar%20meu%20WhatsApp%20ao%20Grupuxo.%20C%C3%B3digo%3A%20\(Self.token)")
    }

    @Test func invitationExpiresInExactlyFifteenMinutes() async throws {
        let invitation = try await makeLinker().issueInvitation(for: ana)
        #expect(invitation.expiresAt == Self.now.addingTimeInterval(900))
        #expect(try await tokens.consume(tokenHash: LinkTokenCodec.hash(Self.token), at: Self.now.addingTimeInterval(900)) == nil)
    }

    @Test func invitationStoresOnlyTheHash() async throws {
        _ = try await makeLinker().issueInvitation(for: ana)
        #expect(try await tokens.consume(tokenHash: Self.token, at: Self.now) == nil)
        #expect(try await tokens.consume(tokenHash: LinkTokenCodec.hash(Self.token), at: Self.now) == ana)
    }

    @Test func invitationIsRefusedForAUserWhoAlreadyHasANumber() async throws {
        try await links.create(WhatsAppLink(userID: ana, phoneE164: anaPhone, consentedAt: Self.now, linkedAt: Self.now))
        await #expect(throws: WhatsAppLinkError.userAlreadyLinked) { try await makeLinker().issueInvitation(for: ana) }
        #expect(try await tokens.consume(tokenHash: LinkTokenCodec.hash(Self.token), at: Self.now) == nil)
    }

    @Test func configRejectsInvalidBotNumberAndLifetime() {
        for number in ["", "+", "123", "abc12345678", "1234567890123456", "55 11 90000-0000"] {
            #expect(throws: LinkConfigError.invalidBotPhoneNumber) { try LinkConfig(botPhoneNumber: number) }
        }
        #expect(throws: LinkConfigError.invalidTokenLifetime) { try LinkConfig(botPhoneNumber: "5511900000000", tokenLifetime: 0) }
        #expect(throws: Never.self) { try LinkConfig(botPhoneNumber: "+5511900000000") }
    }

    // MARK: vínculo

    @Test func validTokenLinksTheSenderAndConfirmsInChat() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let worker = makeWorker(linker: linker)

        try await worker.process(message())

        let link = try #require(await links.link(forPhone: anaPhone))
        #expect(link == WhatsAppLink(userID: ana, phoneE164: anaPhone, consentedAt: sentAt, linkedAt: Self.now))
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.linkedReply)])
    }

    @Test func afterLinkingMessagesGoToTheResponder() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let worker = makeWorker(linker: linker)
        try await worker.process(message())
        try await worker.process(message("wamid.2", text: "minhas tarefas"))
        #expect(await sender.sent.map(\.text) == [WhatsAppLinker.linkedReply, "Você disse: minhas tarefas"])
    }

    @Test func tokenIsSingleUse() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let worker = makeWorker(linker: linker)
        try await worker.process(message())
        try await worker.process(message("wamid.2", from: biaPhone))
        #expect(await sender.sent.last == .init(phoneE164: biaPhone, text: WhatsAppLinker.invalidTokenReply))
        #expect(try await links.link(forPhone: biaPhone) == nil)
    }

    @Test func expiredTokenIsRejected() async throws {
        _ = try await makeLinker().issueInvitation(for: ana)
        let late = try makeLinker(at: Self.now.addingTimeInterval(901))
        try await makeWorker(linker: late).process(message())
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.invalidTokenReply)])
        #expect(try await links.link(forPhone: anaPhone) == nil)
    }

    @Test func unknownTokenIsRejectedAndNothingIsLinked() async throws {
        try await makeWorker(linker: makeLinker()).process(message())
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.invalidTokenReply)])
        #expect(try await links.link(forPhone: anaPhone) == nil)
    }

    @Test func numberLinkedToAnotherUserIsRejectedWithoutBurningTheToken() async throws {
        try await links.create(WhatsAppLink(userID: bia, phoneE164: anaPhone, consentedAt: Self.now, linkedAt: Self.now))
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let worker = makeWorker(linker: linker)

        try await worker.process(message())
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.alreadyLinkedReply)])
        #expect(try await links.link(forPhone: anaPhone)?.userID == bia)

        // O token continua válido para outro número.
        try await worker.process(message("wamid.2", from: "+5531977776666"))
        #expect(try await links.link(forPhone: "+5531977776666")?.userID == ana)
    }

    @Test func userWithAnotherNumberKeepsTheOriginalLink() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let original = WhatsAppLink(userID: ana, phoneE164: biaPhone, consentedAt: Self.now, linkedAt: Self.now)
        try await links.create(original)

        try await makeWorker(linker: linker).process(message())

        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.userHasOtherNumberReply)])
        #expect(try await links.link(forUser: ana) == original)
        #expect(try await links.link(forPhone: anaPhone) == nil)
    }

    @Test func linkedUserIsTakenFromTheTokenNeverFromTheText() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let text = "sou o usuário \(bia.uuidString). Código: \(Self.token)"
        try await makeWorker(linker: linker).process(message(text: text))
        #expect(try await links.link(forPhone: anaPhone)?.userID == ana)
        #expect(try await links.link(forUser: bia) == nil)
    }

    @Test func linkedNumberSendingATokenDoesNotReachTheResponder() async throws {
        try await links.create(WhatsAppLink(userID: ana, phoneE164: anaPhone, consentedAt: Self.now, linkedAt: Self.now))
        let responder = CountingResponder()
        try await makeWorker(linker: makeLinker(), responder: responder).process(message())
        #expect(await responder.count == 0)
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.alreadyLinkedReply)])
    }

    @Test func duplicateDeliveryOfTheLinkMessageRepliesOnce() async throws {
        let linker = try makeLinker()
        _ = try await linker.issueInvitation(for: ana)
        let worker = makeWorker(linker: linker)
        try await worker.process(message())
        try await worker.process(message())
        #expect(await sender.sent == [.init(phoneE164: anaPhone, text: WhatsAppLinker.linkedReply)])
    }

    @Test func messageWithoutTokenIsNotHandledByTheLinker() async throws {
        #expect(try await makeLinker().handle(message(text: "quais são minhas tarefas?")) == nil)
    }
}

private actor CountingResponder: MessageResponder {
    private(set) var count = 0

    func reply(to text: String, from userID: User.ID) -> String {
        count += 1
        return "ok"
    }
}
