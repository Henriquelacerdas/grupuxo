import Foundation

/// Lógica da Lambda `whatsapp-worker`, uma mensagem por vez (o SQS FIFO garante a ordem por telefone).
/// Erros são propagados: o SQS tenta de novo e, esgotadas as tentativas, envia para a DLQ.
public struct WhatsAppWorker: Sendable {
    public static let unlinkedReply = "Não encontrei seu número no Grupuxo. Abra o app, vá em Perfil e toque em Conectar WhatsApp."

    private let inbox: any InboxStore
    private let links: any WhatsAppLinkStore
    private let responder: any MessageResponder
    private let sender: any WhatsAppSender
    private let now: @Sendable () -> Date

    public init(
        inbox: any InboxStore,
        links: any WhatsAppLinkStore,
        responder: any MessageResponder,
        sender: any WhatsAppSender,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.inbox = inbox
        self.links = links
        self.responder = responder
        self.sender = sender
        self.now = now
    }

    public func process(_ message: IncomingMessage) async throws {
        guard try await inbox.claim(wamid: message.wamid, receivedAt: message.receivedAt) == .claimed else { return }

        let reply: String
        if let link = try await links.link(forPhone: message.phoneE164) {
            reply = try await responder.reply(to: message.text, from: link.userID)
        } else {
            reply = Self.unlinkedReply
        }
        try await sender.send(reply, toPhone: message.phoneE164)
        try await inbox.markProcessed(wamid: message.wamid, at: now())
    }
}
