/// Fila entre o webhook e o worker (SQS FIFO em produção).
/// A implementação usa `phoneE164` como `MessageGroupId` e `wamid` como `MessageDeduplicationId`.
public protocol MessageQueue: Sendable {
    func enqueue(_ message: IncomingMessage) async throws
}
