import Foundation

/// Mensagem de texto recebida do WhatsApp, já extraída do payload da Meta.
/// É o corpo que o webhook enfileira e que o worker consome.
public struct IncomingMessage: Hashable, Codable, Sendable {
    /// ID da mensagem na Meta. Chave de idempotência (`whatsapp_inbox`) e `MessageDeduplicationId` do SQS FIFO.
    public let wamid: String
    /// Remetente em E.164 (`+5511999998888`). `MessageGroupId` do SQS FIFO.
    public let phoneE164: String
    public let text: String
    public let receivedAt: Date

    public init(wamid: String, phoneE164: String, text: String, receivedAt: Date) {
        self.wamid = wamid
        self.phoneE164 = phoneE164
        self.text = text
        self.receivedAt = receivedAt
    }
}
