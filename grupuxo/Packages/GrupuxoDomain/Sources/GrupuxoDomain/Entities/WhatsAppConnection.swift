import Foundation

/// Número de WhatsApp conectado ao morador logado. O telefone chega mascarado do servidor; o app nunca vê o número inteiro.
public struct WhatsAppConnection: Hashable, Codable, Sendable {
    public let maskedPhone: String
    public let linkedAt: Date

    public init(maskedPhone: String, linkedAt: Date) {
        self.maskedPhone = maskedPhone
        self.linkedAt = linkedAt
    }
}

/// Convite de uso único para conectar o número: o morador abre o link e envia a mensagem pré-preenchida no WhatsApp.
public struct WhatsAppInvitation: Hashable, Codable, Sendable {
    public let url: URL
    public let expiresAt: Date

    public init(url: URL, expiresAt: Date) {
        self.url = url
        self.expiresAt = expiresAt
    }
}
