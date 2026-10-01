import Foundation
import Testing
import GrupuxoDomain
import WhatsAppCore
import WhatsAppInMemory

/// Contrato que qualquer implementação dos ports (inclusive a de PostgreSQL) deve respeitar.
struct InMemoryStoreTests {
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func inboxClaimsUntilProcessed() async throws {
        let inbox = InMemoryInboxStore()
        #expect(try await inbox.claim(wamid: "w", receivedAt: now) == .claimed)
        #expect(try await inbox.claim(wamid: "w", receivedAt: now) == .claimed)
        try await inbox.markProcessed(wamid: "w", at: now)
        #expect(try await inbox.claim(wamid: "w", receivedAt: now) == .duplicate)
        #expect(try await inbox.claim(wamid: "outra", receivedAt: now) == .claimed)
    }

    @Test func linkIsUniquePerPhoneAndPerUser() async throws {
        let store = InMemoryWhatsAppLinkStore()
        let ana = UUID(), bia = UUID()
        let link = WhatsAppLink(userID: ana, phoneE164: "+5511999998888", consentedAt: now, linkedAt: now)
        try await store.create(link)
        #expect(try await store.link(forPhone: "+5511999998888") == link)
        #expect(try await store.link(forUser: ana) == link)
        await #expect(throws: WhatsAppLinkError.phoneAlreadyLinked) {
            try await store.create(WhatsAppLink(userID: bia, phoneE164: "+5511999998888", consentedAt: now, linkedAt: now))
        }
        await #expect(throws: WhatsAppLinkError.userAlreadyLinked) {
            try await store.create(WhatsAppLink(userID: ana, phoneE164: "+5521988887777", consentedAt: now, linkedAt: now))
        }
    }

    @Test func removingLinkFreesPhoneAndIsIdempotent() async throws {
        let store = InMemoryWhatsAppLinkStore()
        let ana = UUID(), bia = UUID()
        try await store.create(WhatsAppLink(userID: ana, phoneE164: "+5511999998888", consentedAt: now, linkedAt: now))
        try await store.remove(forUser: ana)
        try await store.remove(forUser: ana)
        #expect(try await store.link(forPhone: "+5511999998888") == nil)
        try await store.create(WhatsAppLink(userID: bia, phoneE164: "+5511999998888", consentedAt: now, linkedAt: now))
    }

    @Test func tokenIsSingleUseAndExpires() async throws {
        let store = InMemoryLinkTokenStore()
        let ana = UUID()
        try await store.save(LinkToken(tokenHash: "h1", userID: ana, expiresAt: now.addingTimeInterval(900)))
        #expect(try await store.consume(tokenHash: "h1", at: now) == ana)
        #expect(try await store.consume(tokenHash: "h1", at: now) == nil)

        try await store.save(LinkToken(tokenHash: "h2", userID: ana, expiresAt: now.addingTimeInterval(900)))
        #expect(try await store.consume(tokenHash: "h2", at: now.addingTimeInterval(900)) == nil)
        #expect(try await store.consume(tokenHash: "inexistente", at: now) == nil)
    }
}
