import GrupuxoDomain

/// Decide a resposta para uma mensagem de um morador já identificado.
/// O `userID` vem do vínculo do número, nunca do texto. O Gemini com as ferramentas de leitura
/// será a implementação definitiva; até lá o worker usa `EchoResponder`.
public protocol MessageResponder: Sendable {
    func reply(to text: String, from userID: User.ID) async throws -> String
}

public struct EchoResponder: MessageResponder {
    public init() {}

    public func reply(to text: String, from userID: User.ID) async throws -> String {
        "Você disse: \(text)"
    }
}
