import Amplify
import Foundation
import Testing
@testable import grupuxo

private struct FakeSessionError: Error {}

private final class FakeAuthSessionClient: AuthSessionClient {
    let fetchResult: Result<AuthSessionSnapshot, FakeSessionError>
    let signOutOutcome: AuthSignOutOutcome
    let updatePasswordError: (any Error)?
    private let stream: AsyncStream<AuthSessionEvent>
    private let continuation: AsyncStream<AuthSessionEvent>.Continuation

    init(
        fetch: Result<AuthSessionSnapshot, FakeSessionError>,
        signOut: AuthSignOutOutcome = .complete,
        updatePasswordError: (any Error)? = nil
    ) {
        self.fetchResult = fetch
        self.signOutOutcome = signOut
        self.updatePasswordError = updatePasswordError
        (stream, continuation) = AsyncStream.makeStream()
    }

    convenience init(_ snapshot: AuthSessionSnapshot, signOut: AuthSignOutOutcome = .complete) {
        self.init(fetch: .success(snapshot), signOut: signOut)
    }

    func fetchSession() async throws -> AuthSessionSnapshot { try fetchResult.get() }
    func signOut() async -> AuthSignOutOutcome { signOutOutcome }
    func clearStaleSession() async {}
    func updatePassword(oldPassword: String, newPassword: String) async throws {
        if let updatePasswordError { throw updatePasswordError }
    }
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
        #expect(!service.hasCheckedSession, "não mostra login antes de restaurar a sessão")
        await service.checkSession()
        #expect(service.isSignedIn)
        #expect(service.hasCheckedSession)
        #expect(!service.sessionCheckFailed)
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
        #expect(!service.sessionCheckFailed)
    }

    @Test func failedRestorationOffersRetryInsteadOfLogin() async {
        let service = AuthService(client: FakeAuthSessionClient(fetch: .failure(FakeSessionError())))
        await service.checkSession()
        #expect(service.hasCheckedSession)
        #expect(service.sessionCheckFailed, "falha de conexão na abertura não significa que saiu da conta")
        #expect(!service.isSignedIn)
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

    @Test func signOutRunsTheHookBeforeLeavingTheSession() async {
        let service = AuthService(client: FakeAuthSessionClient(valid))
        await service.checkSession()
        var wasSignedInInTheHook: Bool?
        service.beforeSignOut = { [service] in wasSignedInInTheHook = service.isSignedIn }
        await service.signOut()
        #expect(wasSignedInInTheHook == true)
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

@MainActor
struct ChangePasswordTests {
    private let valid = AuthSessionSnapshot(isSignedIn: true, tokens: .valid)

    private func service(failing error: (any Error)? = nil) -> AuthService {
        AuthService(client: FakeAuthSessionClient(fetch: .success(valid), updatePasswordError: error))
    }

    @Test func changingThePasswordSucceeds() async {
        let outcome = await service().changePassword(oldPassword: "Velha#123", newPassword: "Nova#12345")
        #expect(outcome == .done)
    }

    @Test func emptyOrRepeatedPasswordsNeverReachCognito() async {
        let service = service(failing: FakeSessionError())
        #expect(await service.changePassword(oldPassword: "", newPassword: "Nova#12345") != .done)
        #expect(await service.changePassword(oldPassword: "Velha#123", newPassword: "") != .done)
        let same = await service.changePassword(oldPassword: "Mesma#123", newPassword: "Mesma#123")
        #expect(same == .failed(String(localized: "A senha nova precisa ser diferente da atual.")))
    }

    @Test func aWrongCurrentPasswordIsReportedAsSuch() async {
        let notAuthorized = AuthError.notAuthorized("x", "y", nil)
        let outcome = await service(failing: notAuthorized).changePassword(oldPassword: "Errada#1", newPassword: "Nova#12345")
        #expect(outcome == .wrongPassword)
    }

    @Test func anyOtherFailureKeepsAFriendlyMessage() async {
        let outcome = await service(failing: FakeSessionError()).changePassword(oldPassword: "Velha#123", newPassword: "Nova#12345")
        guard case .failed(let text) = outcome else { Issue.record("esperava falha"); return }
        #expect(!text.isEmpty)
    }

    @Test func viewModelRequiresMatchingNewPasswords() async {
        var calls = 0
        let viewModel = ChangePasswordViewModel { _, _ in calls += 1; return .done }
        viewModel.oldPassword = "Velha#123"
        viewModel.newPassword = "Nova#12345"
        viewModel.confirmation = "Outra#12345"
        await viewModel.save()
        #expect(calls == 0)
        #expect(viewModel.message == String(localized: "As senhas novas não são iguais."))
        #expect(!viewModel.didChange)

        viewModel.confirmation = "Nova#12345"
        await viewModel.save()
        #expect(calls == 1)
        #expect(viewModel.didChange)
    }

    @Test func viewModelShowsTheWrongPasswordMessage() async {
        let viewModel = ChangePasswordViewModel { _, _ in .wrongPassword }
        viewModel.oldPassword = "Errada#1"
        viewModel.newPassword = "Nova#12345"
        viewModel.confirmation = "Nova#12345"
        await viewModel.save()
        #expect(viewModel.message == String(localized: "A senha atual não confere."))
        #expect(!viewModel.didChange)
    }
}

struct AuthEmailNormalizationTests {
    @Test func trimsSpacesAndLowercasesTheEmail() {
        // O preenchimento automático do teclado costuma deixar um espaço no fim; o Cognito trataria como outro usuário.
        #expect(AuthService.normalizedEmail("  Fulana.Silva@Gmail.com \n") == "fulana.silva@gmail.com")
        #expect(AuthService.normalizedEmail("   ") == "")
    }
}
