import Foundation

/// Endereço da `api` do servidor, vindo do `Info.plist` (chave `GrupuxoAPIBaseURL`, definida pelo build setting
/// `GRUPUXO_API_BASE_URL` em `Config/Grupuxo.xcconfig`; o Debug aponta para o `dev` ali mesmo; `Config/Local.xcconfig`, fora do git, é opcional para outro servidor).
struct APIConfiguration: Equatable, Sendable {
    let baseURL: URL

    enum ConfigurationError: Error, LocalizedError, Equatable {
        case missing

        var errorDescription: String? {
            String(localized: "O endereço do servidor não está configurado neste build (GRUPUXO_API_BASE_URL).")
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
