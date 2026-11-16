import Foundation

/// Versão do app e destinos de Ajuda e Sobre, lidos do `Info.plist`. As chaves vêm de build settings em
/// `Config/Grupuxo.xcconfig` (`GRUPUXO_HELP_URL` e as demais); `Config/Local.xcconfig` pode trocá-las.
/// Valor vazio ou inválido vira `nil`, e a linha correspondente não aparece nos Ajustes.
struct AppInfo: Equatable, Sendable {

    let version: String?
    let helpURL: URL?
    let feedbackURL: URL?
    let privacyPolicyURL: URL?
    let termsOfUseURL: URL?

    init(
        version: String? = nil,
        helpURL: URL? = nil,
        feedbackURL: URL? = nil,
        privacyPolicyURL: URL? = nil,
        termsOfUseURL: URL? = nil
    ) {
        self.version = version
        self.helpURL = helpURL
        self.feedbackURL = feedbackURL
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
            helpURL: Self.url(info["GrupuxoHelpURL"]),
            feedbackURL: Self.url(info["GrupuxoFeedbackURL"]),
            privacyPolicyURL: Self.url(info["GrupuxoPrivacyPolicyURL"]),
            termsOfUseURL: Self.url(info["GrupuxoTermsURL"])
        )
    }

    var hasHelpLinks: Bool { helpURL != nil || feedbackURL != nil }

    /// Só `http`, `https` e `mailto` (a sugestão pode ser um e-mail); o resto é configuração errada.
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
