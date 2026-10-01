import WhatsAppCore

/// Guarda as mensagens em vez de chamar a Graph API.
public actor InMemoryWhatsAppSender: WhatsAppSender {
    public struct Sent: Equatable, Sendable {
        public let phoneE164: String
        public let text: String

        public init(phoneE164: String, text: String) {
            self.phoneE164 = phoneE164
            self.text = text
        }
    }

    public private(set) var sent: [Sent] = []

    public init() {}

    public func send(_ text: String, toPhone phoneE164: String) {
        sent.append(Sent(phoneE164: phoneE164, text: text))
    }
}
