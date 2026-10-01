import Foundation
import GrupuxoDomain
import WhatsAppCore

public actor InMemoryLinkTokenStore: LinkTokenStore {
    private var tokens: [String: LinkToken] = [:]
    private var used: Set<String> = []

    public init() {}

    public func save(_ token: LinkToken) {
        tokens[token.tokenHash] = token
    }

    public func consume(tokenHash: String, at date: Date) -> User.ID? {
        guard let token = tokens[tokenHash], !used.contains(tokenHash), token.expiresAt > date else { return nil }
        used.insert(tokenHash)
        return token.userID
    }
}
