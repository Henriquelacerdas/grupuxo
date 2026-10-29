import Foundation

/// Estado dos tokens de uma sessão que o Cognito diz estar aberta.
enum AuthTokenState: Equatable, Sendable {
    case valid
    /// Refresh token vencido: precisa fazer login de novo.
    case expired
    case signedOut
    /// Não deu para saber (por exemplo, sem rede). Não é motivo para deslogar.
    case unavailable
}

struct AuthSessionSnapshot: Equatable, Sendable {
    let isSignedIn: Bool
    let tokens: AuthTokenState

    /// Só desloga com certeza de que a sessão acabou; `.unavailable` mantém quem já estava logado.
    var isActive: Bool {
        isSignedIn && tokens != .expired && tokens != .signedOut
    }
}

enum AuthSessionEvent: Equatable, Sendable {
    case sessionExpired
    case signedOut
}

enum AuthSignOutOutcome: Equatable, Sendable {
    case complete
    case partial
    case failed
}

/// Fronteira do `AuthService` com o Amplify: só `AmplifyAuthSessionClient` importa Amplify/Hub.
protocol AuthSessionClient: Sendable {
    func fetchSession() async throws -> AuthSessionSnapshot
    func signOut() async -> AuthSignOutOutcome
    /// Apaga o usuário no Cognito (a sessão local também é encerrada).
    func deleteUser() async throws
    /// Se o Amplify ainda guarda uma sessão que o app já descartou (tokens vencidos, evento do Hub),
    /// sai só localmente: sem isso qualquer `signIn*` falha com "already a user in signedIn state".
    func clearStaleSession() async
    /// Eventos do Hub; terminar o stream remove o listener.
    func events() -> AsyncStream<AuthSessionEvent>
}
