import Foundation
import GrupuxoDomain

/// Simula o servidor enquanto o app não consome a API (BACKEND.md seção 13, passo 3): gerar o convite não conecta
/// nada; o número só passa a constar como conectado na leitura seguinte, como se o morador já tivesse enviado a
/// mensagem no WhatsApp. O telefone é sempre mascarado, como na API real.
actor MockWhatsAppConnectionRepository: WhatsAppConnectionRepository {
    private var linked: WhatsAppConnection?
    private var invitationIssued = false
    private let now: @Sendable () -> Date

    init(linked: WhatsAppConnection? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.linked = linked
        self.now = now
    }

    func connection() async throws -> WhatsAppConnection? {
        if linked == nil, invitationIssued {
            linked = WhatsAppConnection(maskedPhone: "+55•••••••8888", linkedAt: now())
            invitationIssued = false
        }
        return linked
    }

    func createInvitation() async throws -> WhatsAppInvitation {
        guard linked == nil else { throw WhatsAppConnectionError.alreadyLinked }
        invitationIssued = true
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        var components = URLComponents()
        components.scheme = "https"
        components.host = "wa.me"
        components.path = "/5511900000000"
        components.queryItems = [URLQueryItem(name: "text", value: "Conectar meu WhatsApp ao Reveza. Código: \(token)")]
        guard let url = components.url else { throw WhatsAppConnectionError.unavailable }
        return WhatsAppInvitation(url: url, expiresAt: now().addingTimeInterval(15 * 60))
    }

    func disconnect() async throws {
        linked = nil
        invitationIssued = false
    }
}
