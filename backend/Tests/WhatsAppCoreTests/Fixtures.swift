import Foundation
import Crypto
import WhatsAppCore

enum Fixtures {
    static let appSecret = "segredo-do-app"
    static let verifyToken = "senha-do-webhook"

    static func sign(_ body: Data, secret: String = appSecret) -> String {
        let code = HMAC<SHA256>.authenticationCode(for: body, using: SymmetricKey(data: Data(secret.utf8)))
        return "sha256=" + code.map { String(format: "%02x", $0) }.joined()
    }

    static func textEvent(wamid: String = "wamid.A", from: String = "5511999998888", body: String = "quais são minhas tarefas?", timestamp: String = "1700000000") -> Data {
        payload(messages: """
        [{"from":"\(from)","id":"\(wamid)","timestamp":"\(timestamp)","type":"text","text":{"body":"\(body)"}}]
        """)
    }

    static func payload(messages: String? = nil, statuses: String? = nil, object: String = "whatsapp_business_account", field: String = "messages") -> Data {
        var value = #""messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"123"}"#
        if let messages { value += #","contacts":[{"profile":{"name":"Ana"},"wa_id":"5511999998888"}],"messages":\#(messages)"# }
        if let statuses { value += #","statuses":\#(statuses)"# }
        return Data(#"{"object":"\#(object)","entry":[{"id":"456","changes":[{"field":"\#(field)","value":{\#(value)}}]}]}"#.utf8)
    }

    static func request(method: String = "POST", body: Data, signature: String?) -> WebhookRequest {
        var headers: [String: String] = [:]
        if let signature { headers["x-hub-signature-256"] = signature }
        return WebhookRequest(method: method, headers: headers, body: body)
    }
}
