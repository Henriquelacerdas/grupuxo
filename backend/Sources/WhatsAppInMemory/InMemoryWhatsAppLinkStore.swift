import Foundation
import GrupuxoDomain
import WhatsAppCore

public actor InMemoryWhatsAppLinkStore: WhatsAppLinkStore {
    private var byUser: [User.ID: WhatsAppLink] = [:]

    public init() {}

    public func link(forPhone phoneE164: String) -> WhatsAppLink? {
        byUser.values.first { $0.phoneE164 == phoneE164 }
    }

    public func link(forUser userID: User.ID) -> WhatsAppLink? {
        byUser[userID]
    }

    public func create(_ link: WhatsAppLink) throws {
        guard self.link(forPhone: link.phoneE164) == nil else { throw WhatsAppLinkError.phoneAlreadyLinked }
        guard byUser[link.userID] == nil else { throw WhatsAppLinkError.userAlreadyLinked }
        byUser[link.userID] = link
    }

    public func remove(forUser userID: User.ID) {
        byUser[userID] = nil
    }
}
