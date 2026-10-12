import Foundation
import Testing
@preconcurrency import Amplify
@testable import grupuxo

@MainActor
struct HouseServiceClassifyTests {
    private let expired = AuthError.sessionExpired("expirou", "entre de novo")

    @Test func directSessionExpiredIsClassified() {
        #expect(HouseService.classify(expired) == .sessionExpired)
    }

    @Test func signedOutIsClassifiedAsSessionExpired() {
        #expect(HouseService.classify(AuthError.signedOut("fora", "entre")) == .sessionExpired)
    }

    @Test func wrappedSessionExpiredIsClassified() {
        let wrapped = APIError.operationError("falhou", "tente de novo", expired)
        #expect(HouseService.classify(wrapped) == .sessionExpired)
        let twice = APIError.operationError("externo", "", wrapped)
        #expect(HouseService.classify(twice) == .sessionExpired)
    }

    @Test func networkErrorsAreJustFailures() {
        let offline = URLError(.notConnectedToInternet)
        guard case .failed = HouseService.classify(offline) else {
            Issue.record("erro de rede não deve ser sessionExpired")
            return
        }
        let wrapped = APIError.networkError("sem rede", nil, offline)
        guard case .failed = HouseService.classify(wrapped) else {
            Issue.record("APIError de rede não deve ser sessionExpired")
            return
        }
    }

    @Test func otherAuthErrorsAreFailures() {
        guard case .failed = HouseService.classify(AuthError.notAuthorized("não", "")) else {
            Issue.record("notAuthorized não é sessão vencida")
            return
        }
    }
}
