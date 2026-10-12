import Foundation

public enum WhatsAppConnectionError: Error, LocalizedError, Equatable, Sendable {
    /// O morador já tem um número conectado: para trocar, desconectar e conectar de novo.
    case alreadyLinked
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .alreadyLinked: "Você já tem um WhatsApp conectado."
        case .unavailable: "Não foi possível falar com o servidor agora. Tente de novo em instantes."
        }
    }
}
