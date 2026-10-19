import Foundation

/// Fornece o access token do Cognito para o `Authorization: Bearer`. O servidor só aceita access token (não ID token).
protocol AccessTokenProvider: Sendable {
    func accessToken() async throws -> String
}

/// Fronteira com a rede, para os testes trocarem o `URLSession` por um falso.
protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (data, http)
    }
}

/// Erros da `api` (BACKEND.md seção 6.1): `{ "error": "<código>" }` com o status HTTP.
enum APIError: Error, Equatable, LocalizedError, Sendable {
    /// 401: o token não vale mais. O app volta ao login.
    case unauthorized
    case http(status: Int, code: String)
    /// Sem rede ou servidor fora do ar.
    case network
    /// Resposta que não tem a forma esperada.
    case invalidResponse
    /// Rota que o servidor ainda não tem.
    case unsupported

    var code: String? {
        if case let .http(_, code) = self { return code }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Sua sessão expirou. Entre novamente."
        case .network: "Não foi possível falar com o servidor agora. Tente de novo em instantes."
        case .invalidResponse: "O servidor respondeu algo inesperado."
        case .unsupported: "Esta função ainda não está disponível."
        case let .http(status, code): Self.message(status: status, code: code)
        }
    }

    private static func message(status: Int, code: String) -> String {
        switch code {
        case "invalid_name": "Informe um nome válido."
        case "invalid_house_name": "Informe um nome para a casa."
        case "invalid_timezone": "Fuso horário inválido."
        case "invalid_code": "Código de convite inválido."
        case "already_in_house": "Você já faz parte de uma casa."
        case "no_house": "Você ainda não faz parte de uma casa."
        case "house_deletion_confirmation_required":
            "Você é o último morador: se sair, a casa, os cômodos e as tarefas serão excluídos."
        case "room_deletion_confirmation_required":
            "Você é o último participante de um cômodo: se sair, o cômodo e suas tarefas serão excluídos."
        case "whole_house_protected": "Casa toda sempre inclui todos os moradores."
        case "invalid_room_name": "Informe um nome para o cômodo."
        case "invalid_room_participants": "O cômodo precisa ter participantes válidos."
        case "invalid_task_name": "Informe um nome para a tarefa."
        case "invalid_schedule": "A periodicidade e a política da tarefa são incompatíveis."
        case "task_unavailable": "Esta tarefa não está disponível."
        case "task_already_completed": "Esta tarefa já foi concluída."
        case "no_eligible_members": "O cômodo não possui participantes elegíveis."
        case "already_linked": "Você já tem um WhatsApp conectado."
        case "not_found": "Item não encontrado."
        case "conflict": "Alguém mexeu na casa ao mesmo tempo. Tente de novo."
        case "account_not_registered": "Sua conta ainda não foi registrada. Tente novamente."
        default: status >= 500 ? "O servidor não conseguiu atender agora. Tente de novo em instantes." : "Não foi possível concluir a ação."
        }
    }
}

/// Cliente da `api` do servidor. Sem regra de negócio: monta a requisição, manda o token e traduz erros.
struct APIClient: Sendable {
    let baseURL: URL
    let tokens: any AccessTokenProvider
    let transport: any HTTPTransport

    init(baseURL: URL, tokens: any AccessTokenProvider, transport: any HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.transport = transport
    }

    /// Decodificador dos DTOs: datas ISO 8601 em UTC **com milissegundos** (`2026-10-12T09:00:00.000Z`),
    /// que o `.iso8601` padrão do Swift não lê.
    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(text, strategy: Date.ISO8601FormatStyle()) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Data ISO 8601 inválida")
            )
        }
        return decoder
    }

    /// Faz a chamada e devolve o corpo (vazio em 204). Falhas viram `APIError`.
    @discardableResult
    func send(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: (any Encodable & Sendable)? = nil
    ) async throws -> Data {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidResponse
        }
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let token: String
        do {
            token = try await tokens.accessToken()
        } catch {
            throw APIError.unauthorized
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch let error as APIError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIError.network
        }

        switch response.statusCode {
        case 200..<300:
            return data
        case 401:
            throw APIError.unauthorized
        default:
            struct Failure: Decodable { let error: String }
            let code = (try? JSONDecoder().decode(Failure.self, from: data))?.error ?? ""
            throw APIError.http(status: response.statusCode, code: code)
        }
    }

    func get<T: Decodable>(_ type: T.Type, _ path: String, query: [String: String] = [:]) async throws -> T {
        try decode(type, from: try await send("GET", path, query: query))
    }

    func post<T: Decodable>(
        _ type: T.Type, _ path: String, query: [String: String] = [:], body: (any Encodable & Sendable)? = nil
    ) async throws -> T {
        try decode(type, from: try await send("POST", path, query: query, body: body))
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try Self.makeDecoder().decode(type, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}
