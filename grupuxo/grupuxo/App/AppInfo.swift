import Foundation

/// Versão do app e destinos de Sobre, lidos do `Info.plist`. As chaves vêm de build settings em
/// `Config/Grupuxo.xcconfig` (`GRUPUXO_PRIVACY_POLICY_URL` e `GRUPUXO_TERMS_URL`); `Config/Local.xcconfig` pode trocá-las.
/// Valor vazio ou inválido vira `nil`, e a linha correspondente não aparece nos Ajustes.
struct AppInfo: Equatable, Sendable {

    let version: String?
    let privacyPolicyURL: URL?
    let termsOfUseURL: URL?

    init(
        version: String? = nil,
        privacyPolicyURL: URL? = nil,
        termsOfUseURL: URL? = nil
    ) {
        self.version = version
        self.privacyPolicyURL = privacyPolicyURL
        self.termsOfUseURL = termsOfUseURL
    }

    init(bundle: Bundle) {
        self.init(info: bundle.infoDictionary ?? [:])
    }

    /// Separado do `Bundle` para o teste poder simular um `Info.plist`.
    init(info: [String: Any]) {
        self.init(
            version: info["CFBundleShortVersionString"] as? String,
            privacyPolicyURL: Self.url(info["GrupuxoPrivacyPolicyURL"]),
            termsOfUseURL: Self.url(info["GrupuxoTermsURL"])
        )
    }

    /// Caixa que recebe as sugestões dos moradores.
    static let feedbackEmail = "reveza.app@gmail.com"

    /// E-mail pronto para enviar: destinatário e assunto preenchidos; o corpo fica para o morador escrever.
    static var feedbackMailURL: URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = feedbackEmail
        components.queryItems = [URLQueryItem(name: "subject", value: String(localized: "Sugestão para o Reveza"))]
        return components.url
    }

    /// Só `http`, `https` e `mailto`; o resto é configuração errada.
    private static func url(_ value: Any?) -> URL? {
        guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty, !text.contains("CONFIGURE-ME"),
              let url = URL(string: text), let scheme = url.scheme?.lowercased()
        else { return nil }

        switch scheme {
        case "http", "https": return url.host != nil ? url : nil
        case "mailto": return url
        default: return nil
        }
    }
}
