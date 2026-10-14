import Foundation
@preconcurrency import Amplify
import AWSPluginsCore

/// Access token do Cognito pela sessão do Amplify (renovado por ele quando preciso). O servidor recusa ID token.
struct AmplifyAccessTokenProvider: AccessTokenProvider {
    func accessToken() async throws -> String {
        let session = try await Amplify.Auth.fetchAuthSession()
        guard session.isSignedIn, let provider = session as? AuthCognitoTokensProvider else {
            throw APIError.unauthorized
        }
        return try provider.getCognitoTokens().get().accessToken
    }
}
