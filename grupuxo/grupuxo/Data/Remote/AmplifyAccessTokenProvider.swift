import Foundation
@preconcurrency import Amplify
import AWSPluginsCore

/// Access token do Cognito pela sessão do Amplify (renovado por ele quando preciso). O servidor recusa ID token.
struct AmplifyAccessTokenProvider: AccessTokenProvider {
    func accessToken(forceRefresh: Bool) async throws -> String {
        do {
            let session = try await Amplify.Auth.fetchAuthSession(options: .init(forceRefresh: forceRefresh))
            guard session.isSignedIn else { throw APIError.unauthorized }
            guard let provider = session as? AuthCognitoTokensProvider else { throw APIError.invalidResponse }
            let token = try provider.getCognitoTokens().get().accessToken
            // O widget busca as tarefas sozinho: guarda o endereço e o token no Keychain compartilhado.
            if let configuration = try? APIConfiguration() {
                WidgetTaskStore.shared.saveCredentials(baseURL: configuration.baseURL, accessToken: token)
            }
            return token
        } catch let error as AuthError {
            switch error {
            case .sessionExpired, .signedOut, .notAuthorized:
                throw APIError.unauthorized
            default:
                if let underlying = error.underlyingError as? URLError, underlying.code == .cancelled {
                    throw CancellationError()
                }
                throw APIError.network
            }
        }
    }
}
