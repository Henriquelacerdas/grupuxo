import Foundation
import GrupuxoDomain

public enum LinkConfigError: Error, Equatable, Sendable {
    /// O número do bot precisa ter de 8 a 15 dígitos (E.164 sem formatação).
    case invalidBotPhoneNumber
    case invalidTokenLifetime
}

public struct LinkConfig: Sendable {
    /// Número do bot só com dígitos, como o `wa.me` espera (`5511999998888`).
    public let botPhoneNumber: String
    public let tokenLifetime: TimeInterval

    /// Aceita um `+` inicial e o descarta.
    public init(botPhoneNumber: String, tokenLifetime: TimeInterval = 15 * 60) throws {
        let digits = botPhoneNumber.hasPrefix("+") ? String(botPhoneNumber.dropFirst()) : botPhoneNumber
        guard (8...15).contains(digits.utf8.count), digits.utf8.allSatisfy({ (UInt8(ascii: "0")...UInt8(ascii: "9")).contains($0) }) else {
            throw LinkConfigError.invalidBotPhoneNumber
        }
        guard tokenLifetime > 0 else { throw LinkConfigError.invalidTokenLifetime }
        self.botPhoneNumber = digits
        self.tokenLifetime = tokenLifetime
    }
}

public struct LinkInvitation: Equatable, Sendable {
    /// `https://wa.me/<numero>?text=<mensagem com o token>`. É o único lugar onde o token existe em claro.
    public let url: String
    public let expiresAt: Date

    public init(url: String, expiresAt: Date) {
        self.url = url
        self.expiresAt = expiresAt
    }
}

/// Vínculo número ↔ morador por token de uso único (BACKEND.md, seção 8).
/// Só traduz o canal em chamadas aos ports; o `userID` vem sempre do token, nunca do texto da mensagem.
public struct WhatsAppLinker: Sendable {
    public static let linkedReply = "Pronto! Seu WhatsApp está conectado ao Grupuxo. Pergunte, por exemplo: quais são minhas tarefas?"
    // Redação neutra de propósito: vale também para a nova tentativa depois de uma falha ao enviar a confirmação.
    public static let alreadyLinkedReply = "Este número já está conectado ao Grupuxo."
    public static let invalidTokenReply = "Link inválido ou expirado. Gere outro no app, em Perfil › Conectar WhatsApp."
    public static let userHasOtherNumberReply = "Sua conta já tem outro número conectado. Desconecte no app e tente de novo."

    private let config: LinkConfig
    private let tokens: any LinkTokenStore
    private let links: any WhatsAppLinkStore
    private let now: @Sendable () -> Date
    private let randomBytes: @Sendable (Int) -> [UInt8]

    public init(
        config: LinkConfig,
        tokens: any LinkTokenStore,
        links: any WhatsAppLinkStore,
        now: @escaping @Sendable () -> Date = { Date() },
        randomBytes: @escaping @Sendable (Int) -> [UInt8] = LinkTokenCodec.systemRandomBytes
    ) {
        self.config = config
        self.tokens = tokens
        self.links = links
        self.now = now
        self.randomBytes = randomBytes
    }

    /// Gera o convite para o morador autenticado (futuro `POST /me/whatsapp/link`).
    /// Lança `WhatsAppLinkError.userAlreadyLinked` se ele já tem número conectado.
    public func issueInvitation(for userID: User.ID) async throws -> LinkInvitation {
        guard try await links.link(forUser: userID) == nil else { throw WhatsAppLinkError.userAlreadyLinked }
        let token = LinkTokenCodec.generate(randomBytes: randomBytes)
        let expiresAt = now().addingTimeInterval(config.tokenLifetime)
        try await tokens.save(LinkToken(tokenHash: LinkTokenCodec.hash(token), userID: userID, expiresAt: expiresAt))
        return LinkInvitation(url: url(for: token), expiresAt: expiresAt)
    }

    /// Devolve `nil` se a mensagem não traz token (o worker segue o fluxo normal); senão, a resposta ao remetente.
    ///
    /// Consumir o token e criar o vínculo são duas chamadas: se `create` falhar depois do `consume`, o token fica
    /// queimado e o morador gera outro. Com PostgreSQL isso passa a ser uma transação no adaptador.
    public func handle(_ message: IncomingMessage) async throws -> String? {
        guard let token = LinkTokenCodec.extract(from: message.text) else { return nil }

        // Antes do consume, para um número já vinculado não queimar um token que outro número ainda pode usar.
        guard try await links.link(forPhone: message.phoneE164) == nil else { return Self.alreadyLinkedReply }
        guard let userID = try await tokens.consume(tokenHash: LinkTokenCodec.hash(token), at: now()) else {
            return Self.invalidTokenReply
        }
        do {
            // Enviar o token é o aceite: `consentedAt` é o horário da mensagem do usuário.
            try await links.create(WhatsAppLink(userID: userID, phoneE164: message.phoneE164, consentedAt: message.receivedAt, linkedAt: now()))
        } catch WhatsAppLinkError.phoneAlreadyLinked {
            return Self.alreadyLinkedReply
        } catch WhatsAppLinkError.userAlreadyLinked {
            return Self.userHasOtherNumberReply
        }
        return Self.linkedReply
    }

    private func url(for token: String) -> String {
        // Só ASCII seguro: `.urlQueryAllowed` deixaria `&`, `+` e `=` passarem, e `.alphanumerics` aceita acentos.
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let text = "Conectar meu WhatsApp ao Grupuxo. Código: \(token)"
        let encoded = text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
        return "https://wa.me/\(config.botPhoneNumber)?text=\(encoded)"
    }
}
