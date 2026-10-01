import Foundation
import WhatsAppCore

public actor InMemoryInboxStore: InboxStore {
    private var processedAt: [String: Date?] = [:]

    public init() {}

    public func claim(wamid: String, receivedAt: Date) -> InboxClaim {
        if let existing = processedAt[wamid], existing != nil { return .duplicate }
        processedAt[wamid] = .some(nil)
        return .claimed
    }

    public func markProcessed(wamid: String, at date: Date) {
        processedAt[wamid] = .some(date)
    }
}
