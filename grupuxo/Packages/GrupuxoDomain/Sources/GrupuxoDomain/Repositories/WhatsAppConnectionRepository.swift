import Foundation

/// Conexão do WhatsApp do morador logado. Não recebe `userID`: no servidor o morador vem sempre do token de
/// acesso (`POST /v1/me/whatsapp/link`, `GET` e `DELETE /v1/me/whatsapp`), nunca de um campo enviado pelo app.
public protocol WhatsAppConnectionRepository: Sendable {
    /// `nil` quando não há número conectado.
    func connection() async throws -> WhatsAppConnection?
    /// Lança `WhatsAppConnectionError.alreadyLinked` se já houver número conectado.
    func createInvitation() async throws -> WhatsAppInvitation
    /// Idempotente: sem número conectado, não faz nada.
    func disconnect() async throws
}
