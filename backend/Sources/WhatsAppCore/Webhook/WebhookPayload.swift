import Foundation

/// Subconjunto do payload do webhook da WhatsApp Cloud API que o backend usa.
/// Campos não declarados (como `statuses`, `contacts` e `metadata`) são ignorados pelo `Decodable`.
struct WebhookPayload: Decodable {
    let object: String?
    let entry: [Entry]?

    struct Entry: Decodable {
        let changes: [Change]?
    }

    struct Change: Decodable {
        let field: String?
        let value: Value?
    }

    struct Value: Decodable {
        let messages: [Message]?
    }

    struct Message: Decodable {
        let from: String
        let id: String
        let timestamp: String?
        let type: String
        let text: Text?
    }

    struct Text: Decodable {
        let body: String
    }
}

extension WebhookPayload {
    /// Mensagens de texto do payload, na ordem de chegada. Outros tipos (imagem, áudio, reação…)
    /// e os eventos de `statuses` (entregue, lido) são descartados na v1.
    func incomingTextMessages(fallbackDate: Date) -> [IncomingMessage] {
        guard object == "whatsapp_business_account" else { return [] }
        var result: [IncomingMessage] = []
        for change in (entry ?? []).flatMap({ $0.changes ?? [] }) where change.field == nil || change.field == "messages" {
            for message in change.value?.messages ?? [] {
                guard message.type == "text",
                      let body = message.text?.body, !body.isEmpty,
                      let phone = Self.e164(fromWhatsAppID: message.from)
                else { continue }
                var receivedAt = fallbackDate
                if let seconds = message.timestamp.flatMap({ TimeInterval($0) }) {
                    receivedAt = Date(timeIntervalSince1970: seconds)
                }
                result.append(IncomingMessage(wamid: message.id, phoneE164: phone, text: body, receivedAt: receivedAt))
            }
        }
        return result
    }

    /// A Meta envia o número só com dígitos (`5511999998888`); o backend guarda em E.164 (`+5511999998888`).
    static func e164(fromWhatsAppID id: String) -> String? {
        let digits = id.filter(\.isASCII).filter(\.isNumber)
        return digits.isEmpty ? nil : "+" + digits
    }
}
