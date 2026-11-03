import Foundation
import Testing
@testable import grupuxo

private struct FakeSessionError: Error {}

private final class FakeAuthSessionClient: AuthSessionClient {
    let fetchResult: Result<AuthSessionSnapshot, FakeSessionError>
    let signOutOutcome: AuthSignOutOutcome
    private let stream: AsyncStream<AuthSessionEvent>
    private let continuation: AsyncStream<AuthSessionEvent>.Continuation

    init(
        fetch: Result<AuthSessionSnapshot, FakeSessionError>,
        signOut: AuthSignOutOutcome = .complete
    ) {
        self.fetchResult = fetch
        self.signOutOutcome = signOut
        (stream, continuation) = AsyncStream.makeStream()
    }

    convenience init(_ snapshot: AuthSessionSnapshot, signOut: AuthSignOutOutcome = .complete) {
        self.init(fetch: .success(snapshot), signOut: signOut)
    }

    func fetchSession() async throws -> AuthSessionSnapshot { try fetchResult.get() }
    func signOut() async -> AuthSignOutOutcome { signOutOutcome }
    func clearStaleSession() async {}
    func events() -> AsyncStream<AuthSessionEvent> { stream }
    func send(_ event: AuthSessionEvent) { continuation.yield(event) }
}

@MainActor
struct AuthServiceSessionTests {
    private let valid = AuthSessionSnapshot(isSignedIn: true, tokens: .valid)

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<200 where !condition() { await Task.yield() }
    }

    @Test func validSessionSignsIn() async {
        let service = AuthService(client: FakeAuthSessionClient(valid))
        await service.checkSession()
        #expect(service.isSignedIn)
    }

    @Test func expiredSessionSignsOut() async {
        let service = AuthService(client: FakeAuthSessionClient(.init(isSignedIn: true, tokens: .expired)))
        service.isSignedIn = true
        await service.checkSession()
        #expect(!service.isSignedIn)
    }

    @Test func signedOutTokensSignOut() async {
        let service = AuthService(client: FakeAuthSessionClient(.init(isSignedIn: true, tokens: .signedOut)))
        service.isSignedIn = true
        await service.checkSession()
        #expect(!service.isSignedIn)
    }

    @Test func notSignedInStaysOnLogin() async {
        let service = AuthService(client: FakeAuthSessionClient(.init(isSignedIn: false, tokens: .signedOut)))
        await service.checkSession()
        #expect(!service.isSignedIn)
    }

    @Test func offlineKeepsTheSessionOpen() async {
        let service = AuthService(client: FakeAuthSessionClient(.init(isSignedIn: true, tokens: .unavailable)))
        await service.checkSession()
        #expect(service.isSignedIn)
        service.isSignedIn = true
        await service.checkSession()
        #expect(service.isSignedIn)
    }

    @Test func fetchFailureDoesNotChangeState() async {
        let service = AuthService(client: FakeAuthSessionClient(fetch: .failure(FakeSessionError())))
        service.isSignedIn = true
        await service.checkSession()
        #expect(service.isSignedIn)
    }

    @Test(arguments: [AuthSessionEvent.sessionExpired, .signedOut])
    func hubEventWhileOpenSignsOut(event: AuthSessionEvent) async {
        let client = FakeAuthSessionClient(valid)
        let service = AuthService(client: client)
        await service.checkSession()
        #expect(service.isSignedIn)

        client.send(event)
        await waitUntil { !service.isSignedIn }
        #expect(!service.isSignedIn)
    }

    @Test(arguments: [AuthSignOutOutcome.complete, .partial, .failed])
    func signOutAlwaysClearsLocalState(outcome: AuthSignOutOutcome) async {
        let service = AuthService(client: FakeAuthSessionClient(valid, signOut: outcome))
        await service.checkSession()
        #expect(service.isSignedIn)
        await service.signOut()
        #expect(!service.isSignedIn)
    }
}

struct AuthEmailNormalizationTests {
    @Test func trimsSpacesAndLowercasesTheEmail() {
        // O preenchimento automático do teclado costuma deixar um espaço no fim; o Cognito trataria como outro usuário.
        #expect(AuthService.normalizedEmail("  Fulana.Silva@Gmail.com \n") == "fulana.silva@gmail.com")
        #expect(AuthService.normalizedEmail("   ") == "")
    }
}
