import Foundation

public enum InboxClaim: Equatable, Sendable {
    /// Primeira entrega, ou entrega anterior que não chegou a ser concluída: processar.
    case claimed
    /// Já processada com sucesso: descartar.
    case duplicate
}

/// Idempotência e auditoria (`whatsapp_inbox`). Só guarda `wamid` e horários, nunca o texto da mensagem.
public protocol InboxStore: Sendable {
    /// Registra o `wamid` se for novo. Uma mensagem registrada mas ainda sem `processed_at`
    /// (o worker caiu no meio) volta como `.claimed`, para a nova tentativa não perdê-la.
    func claim(wamid: String, receivedAt: Date) async throws -> InboxClaim
    func markProcessed(wamid: String, at date: Date) async throws
}
