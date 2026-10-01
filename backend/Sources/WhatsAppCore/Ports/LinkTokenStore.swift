import Foundation
import GrupuxoDomain

/// Token de vínculo de uso único (`whatsapp_link_tokens`). Só o hash é persistido.
public struct LinkToken: Hashable, Sendable {
    /// SHA-256 do token em hexadecimal minúsculo.
    public let tokenHash: String
    public let userID: User.ID
    public let expiresAt: Date

    public init(tokenHash: String, userID: User.ID, expiresAt: Date) {
        self.tokenHash = tokenHash
        self.userID = userID
        self.expiresAt = expiresAt
    }
}

public protocol LinkTokenStore: Sendable {
    func save(_ token: LinkToken) async throws
    /// Atômico: se o token existe, não foi usado e não expirou em `date`, marca como usado e devolve o dono.
    /// Caso contrário devolve `nil`. Em SQL: `UPDATE ... WHERE used_at IS NULL AND expires_at > $2 RETURNING user_id`.
    func consume(tokenHash: String, at date: Date) async throws -> User.ID?
}
