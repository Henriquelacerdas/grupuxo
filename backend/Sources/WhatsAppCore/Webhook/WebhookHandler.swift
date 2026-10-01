import Foundation

/// Requisição HTTP já desacoplada do API Gateway. A Lambda `whatsapp-webhook` só converte o evento nisto.
public struct WebhookRequest: Sendable {
    public let method: String
    public let queryParameters: [String: String]
    public let headers: [String: String]
    /// Corpo **bruto**: a assinatura é calculada sobre os bytes exatos recebidos.
    public let body: Data

    public init(method: String, queryParameters: [String: String] = [:], headers: [String: String] = [:], body: Data = Data()) {
        self.method = method
        self.queryParameters = queryParameters
        self.headers = headers
        self.body = body
    }

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

public struct WebhookResponse: Equatable, Sendable {
    public let statusCode: Int
    public let body: String

    public init(statusCode: Int, body: String = "") {
        self.statusCode = statusCode
        self.body = body
    }
}

public struct WebhookConfig: Sendable {
    /// `VERIFY_TOKEN`: "senha" da verificação (GET).
    public let verifyToken: String
    /// `WHATSAPP_APP_SECRET`: valida a assinatura dos eventos (POST).
    public let appSecret: String

    public init(verifyToken: String, appSecret: String) {
        self.verifyToken = verifyToken
        self.appSecret = appSecret
    }
}

/// Lógica da Lambda `whatsapp-webhook`: responde ao *challenge*, valida a assinatura e enfileira.
/// Não chama LLM nem domínio, para responder 200 em milissegundos.
public struct WebhookHandler: Sendable {
    private let config: WebhookConfig
    private let verifier: SignatureVerifier
    private let queue: any MessageQueue
    private let now: @Sendable () -> Date

    public init(config: WebhookConfig, queue: any MessageQueue, now: @escaping @Sendable () -> Date = { Date() }) {
        self.config = config
        self.verifier = SignatureVerifier(appSecret: config.appSecret)
        self.queue = queue
        self.now = now
    }

    public func handle(_ request: WebhookRequest) async -> WebhookResponse {
        switch request.method.uppercased() {
        case "GET": verify(request)
        case "POST": await receive(request)
        default: WebhookResponse(statusCode: 405)
        }
    }

    private func verify(_ request: WebhookRequest) -> WebhookResponse {
        let parameters = request.queryParameters
        guard parameters["hub.mode"] == "subscribe",
              !config.verifyToken.isEmpty,
              let token = parameters["hub.verify_token"],
              constantTimeEquals(token, config.verifyToken),
              let challenge = parameters["hub.challenge"]
        else { return WebhookResponse(statusCode: 403) }
        return WebhookResponse(statusCode: 200, body: challenge)
    }

    private func receive(_ request: WebhookRequest) async -> WebhookResponse {
        guard verifier.isValid(signatureHeader: request.header("X-Hub-Signature-256"), body: request.body) else {
            return WebhookResponse(statusCode: 401)
        }
        guard let payload = try? JSONDecoder().decode(WebhookPayload.self, from: request.body) else {
            return WebhookResponse(statusCode: 400)
        }
        do {
            for message in payload.incomingTextMessages(fallbackDate: now()) {
                try await queue.enqueue(message)
            }
        } catch {
            // 5xx faz a Meta reenviar o evento; mensagens já enfileiradas são deduplicadas por `wamid`.
            return WebhookResponse(statusCode: 500)
        }
        return WebhookResponse(statusCode: 200)
    }
}
