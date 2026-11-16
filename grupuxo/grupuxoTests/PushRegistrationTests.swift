import Foundation
import Testing
@testable import grupuxo

@MainActor
struct PushRegistrationTests {

    @Test func signingOutRemovesTheTokenFromTheServer() async {
        let registration = PushRegistration()
        var removed: [String] = []
        registration.removeToken = { removed.append($0) }

        registration.didRegister(deviceToken: Data([0xAB, 0x01]))
        await registration.unregisterFromServer()

        #expect(removed == ["ab01"])
    }

    @Test func withoutATokenThereIsNothingToRemove() async {
        let registration = PushRegistration()
        var removed: [String] = []
        registration.removeToken = { removed.append($0) }

        await registration.unregisterFromServer()

        #expect(removed.isEmpty)
    }
}
