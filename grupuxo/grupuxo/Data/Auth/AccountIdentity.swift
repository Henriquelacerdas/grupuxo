import Foundation
@preconcurrency import Amplify
import AWSPluginsCore

/// O que a tela Conta mostra sobre o login: e-mail e por onde o morador entrou.
/// Vem das claims do ID token do Cognito: o servidor não guarda e-mail, e `fetchUserAttributes` exigiria o escopo
/// `aws.cognito.signin.user.admin`, que o app client não tem (BACKEND.md seção 6.1, `DELETE /v1/me`).
struct AccountIdentity: Equatable, Sendable {

    enum Provider: Equatable, Sendable {
        case password
        case apple
    }

    let email: String?
    /// `nil` para um provedor que o app não oferece: a tela esconde a linha em vez de rotular errado.
    let provider: Provider?

    init(email: String?, provider: Provider?) {
        self.email = email
        self.provider = provider
    }

    /// `nil` quando o token não é um JWT legível.
    init?(idToken: String) {
        let parts = idToken.split(separator: ".")
        guard parts.count >= 2,
              let payload = Self.decodeBase64URL(String(parts[1])),
              let claims = try? JSONDecoder().decode(Claims.self, from: payload)
        else { return nil }

        let email = claims.email?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.email = (email?.isEmpty ?? true) ? nil : email
        self.provider = Self.provider(forProviderName: claims.identities.first?.providerName)
    }

    private static func provider(forProviderName name: String?) -> Provider? {
        switch name {
        // Sem `identities` o morador entrou com e-mail e senha pelo próprio user pool.
        case nil: .password
        case "SignInWithApple": .apple
        default: nil
        }
    }

    private static func decodeBase64URL(_ text: String) -> Data? {
        var base64 = text
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64.append(String(repeating: "=", count: (4 - base64.count % 4) % 4))
        return Data(base64Encoded: base64)
    }

    private struct Claims: Decodable {

        struct Identity: Decodable {
            let providerName: String
        }

        let email: String?
        let identities: [Identity]

        enum CodingKeys: String, CodingKey { case email, identities }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            email = try container.decodeIfPresent(String.self, forKey: .email)
            // No ID token `identities` é uma lista; nos atributos do usuário ela vem como texto JSON.
            if let list = try? container.decodeIfPresent([Identity].self, forKey: .identities) {
                identities = list
            } else if let text = try? container.decodeIfPresent(String.self, forKey: .identities),
                      let data = text.data(using: .utf8),
                      let list = try? JSONDecoder().decode([Identity].self, from: data) {
                identities = list
            } else {
                identities = []
            }
        }
    }
}

/// Fronteira da tela Conta com o Amplify (só `Data/Auth` importa Amplify).
protocol AccountIdentityReading: Sendable {
    func identity() async -> AccountIdentity?
}

struct AmplifyAccountIdentityReader: AccountIdentityReading {

    func identity() async -> AccountIdentity? {
        guard let session = try? await Amplify.Auth.fetchAuthSession(),
              session.isSignedIn,
              let provider = session as? AuthCognitoTokensProvider,
              let tokens = try? provider.getCognitoTokens().get()
        else { return nil }
        return AccountIdentity(idToken: tokens.idToken)
    }
}

/// Container de testes e pré-visualizações: sem sessão do Amplify, a tela Conta só não mostra e-mail nem provedor.
struct UnavailableAccountIdentityReader: AccountIdentityReading {
    func identity() async -> AccountIdentity? { nil }
}
