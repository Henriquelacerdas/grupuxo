import Foundation
import GrupuxoDomain

/// Vínculo entre um número de WhatsApp e um morador (`whatsapp_links`).
public struct WhatsAppLink: Hashable, Sendable {
    public let userID: User.ID
    public let phoneE164: String
    public let consentedAt: Date
    public let linkedAt: Date

    public init(userID: User.ID, phoneE164: String, consentedAt: Date, linkedAt: Date) {
        self.userID = userID
        self.phoneE164 = phoneE164
        self.consentedAt = consentedAt
        self.linkedAt = linkedAt
    }
}

public enum WhatsAppLinkError: Error, Equatable, Sendable {
    /// `phone_e164` é único: um número, um morador.
    case phoneAlreadyLinked
    /// Um morador tem no máximo um número; para trocar, desconectar e conectar de novo.
    case userAlreadyLinked
}

public protocol WhatsAppLinkStore: Sendable {
    func link(forPhone phoneE164: String) async throws -> WhatsAppLink?
    func link(forUser userID: User.ID) async throws -> WhatsAppLink?
    /// Lança `WhatsAppLinkError` se o número ou o morador já tiverem vínculo.
    func create(_ link: WhatsAppLink) async throws
    /// Idempotente: sem vínculo, não faz nada.
    func remove(forUser userID: User.ID) async throws
}
