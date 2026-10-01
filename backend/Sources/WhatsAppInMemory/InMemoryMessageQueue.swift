import WhatsAppCore

public actor InMemoryMessageQueue: MessageQueue {
    private var pending: [IncomingMessage] = []

    public init() {}

    public func enqueue(_ message: IncomingMessage) {
        pending.append(message)
    }

    /// Entrega e esvazia as mensagens pendentes, na ordem de chegada.
    public func drain() -> [IncomingMessage] {
        defer { pending.removeAll() }
        return pending
    }
}
