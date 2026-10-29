import Foundation
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

struct AmplifyAuthSessionClient: AuthSessionClient {
    func fetchSession() async throws -> AuthSessionSnapshot {
        let session = try await Amplify.Auth.fetchAuthSession()
        guard session.isSignedIn else {
            return AuthSessionSnapshot(isSignedIn: false, tokens: .signedOut)
        }
        guard let provider = session as? AuthCognitoTokensProvider else {
            return AuthSessionSnapshot(isSignedIn: true, tokens: .unavailable)
        }
        switch provider.getCognitoTokens() {
        case .success:
            return AuthSessionSnapshot(isSignedIn: true, tokens: .valid)
        case .failure(let error):
            switch error {
            case .sessionExpired: return AuthSessionSnapshot(isSignedIn: true, tokens: .expired)
            case .signedOut: return AuthSessionSnapshot(isSignedIn: true, tokens: .signedOut)
            // Offline: o Amplify devolve `.service(… AWSCognitoAuthError.network)`.
            default: return AuthSessionSnapshot(isSignedIn: true, tokens: .unavailable)
            }
        }
    }

    func signOut() async -> AuthSignOutOutcome {
        let result = await Amplify.Auth.signOut(options: .init(globalSignOut: false))
        guard let result = result as? AWSCognitoSignOutResult else { return .failed }
        switch result {
        case .complete: return .complete
        case .partial: return .partial
        case .failed(let error):
            print("Erro no logout: \(error)")
            return .failed
        }
    }

    func deleteUser() async throws {
        try await Amplify.Auth.deleteUser()
    }

    func clearStaleSession() async {
        guard let session = try? await Amplify.Auth.fetchAuthSession(), session.isSignedIn else { return }
        _ = await Amplify.Auth.signOut(options: .init(globalSignOut: false))
    }

    func events() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { continuation in
            let token = Amplify.Hub.listen(to: .auth) { payload in
                switch payload.eventName {
                case HubPayload.EventName.Auth.sessionExpired: continuation.yield(.sessionExpired)
                case HubPayload.EventName.Auth.signedOut: continuation.yield(.signedOut)
                default: break
                }
            }
            continuation.onTermination = { _ in Amplify.Hub.removeListener(token) }
        }
    }
}
