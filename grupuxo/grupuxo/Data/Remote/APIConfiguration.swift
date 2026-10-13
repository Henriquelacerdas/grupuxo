import Foundation

/// Endereço da `api` do servidor, vindo do `Info.plist` (chave `GrupuxoAPIBaseURL`, definida pelo build setting
/// `GRUPUXO_API_BASE_URL`: Debug aponta para o servidor local, Release para o endereço público do túnel).
struct APIConfiguration: Equatable, Sendable {
    let baseURL: URL

    enum ConfigurationError: Error, LocalizedError, Equatable {
        case missing

        var errorDescription: String? {
            "O endereço do servidor não está configurado neste build (GRUPUXO_API_BASE_URL)."
        }
    }

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    /// Falha fechada: sem valor, ou com o valor de exemplo (`CONFIGURE-ME`), o app não tenta falar com servidor nenhum.
    init(bundle: Bundle = .main) throws {
        guard let text = bundle.object(forInfoDictionaryKey: "GrupuxoAPIBaseURL") as? String,
              !text.isEmpty, !text.contains("CONFIGURE-ME"),
              let url = URL(string: text), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil
        else { throw ConfigurationError.missing }
        self.baseURL = url
    }
}
