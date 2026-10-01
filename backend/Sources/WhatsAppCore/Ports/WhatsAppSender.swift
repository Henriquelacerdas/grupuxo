/// Envio de mensagens pela Graph API da Meta.
public protocol WhatsAppSender: Sendable {
    func send(_ text: String, toPhone phoneE164: String) async throws
}
