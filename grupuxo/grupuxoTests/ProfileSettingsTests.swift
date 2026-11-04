import Foundation
import Testing
@testable import grupuxo

struct ProfileSettingsTests {

    private func idToken(_ claims: String) -> String {
        func encode(_ text: String) -> String {
            Data(text.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return [encode(#"{"alg":"RS256"}"#), encode(claims), "assinatura"].joined(separator: ".")
    }

    @Test func passwordLoginHasNoIdentities() throws {
        let identity = try #require(AccountIdentity(idToken: idToken(#"{"email":"ana@example.com"}"#)))
        #expect(identity == AccountIdentity(email: "ana@example.com", provider: .password))
    }

    @Test func appleLoginIsReadFromIdentitiesList() throws {
        let claims = #"{"email":"ana@privaterelay.appleid.com","identities":[{"providerName":"SignInWithApple","userId":"1"}]}"#
        let identity = try #require(AccountIdentity(idToken: idToken(claims)))
        #expect(identity.provider == .apple)
        #expect(identity.email == "ana@privaterelay.appleid.com")
    }

    @Test func identitiesAsJSONTextIsAlsoUnderstood() throws {
        let claims = #"{"identities":"[{\"providerName\":\"SignInWithApple\"}]"}"#
        let identity = try #require(AccountIdentity(idToken: idToken(claims)))
        #expect(identity == AccountIdentity(email: nil, provider: .apple))
    }

    @Test func unknownProviderHidesTheLabelInsteadOfGuessing() throws {
        let identity = try #require(AccountIdentity(idToken: idToken(#"{"identities":[{"providerName":"Google"}]}"#)))
        #expect(identity.provider == nil)
    }

    @Test func unreadableTokenGivesNoIdentity() {
        #expect(AccountIdentity(idToken: "isto-nao-e-um-jwt") == nil)
        #expect(AccountIdentity(idToken: "a.%%%.c") == nil)
    }

    @Test func emptyOrInvalidLinksAreHidden() {
        let info = AppInfo(info: [
            "CFBundleShortVersionString": "1.2",
            "GrupuxoHelpURL": "",
            "GrupuxoFeedbackURL": "mailto:ola@example.com",
            "GrupuxoPrivacyPolicyURL": "https://example.com/privacidade",
            "GrupuxoTermsURL": "ftp://example.com/termos"
        ])
        #expect(info.version == "1.2")
        #expect(info.helpURL == nil)
        #expect(info.feedbackURL?.scheme == "mailto")
        #expect(info.privacyPolicyURL?.host == "example.com")
        #expect(info.termsOfUseURL == nil)
        #expect(info.hasHelpLinks)
    }

    @Test func missingKeysLeaveEverythingHidden() {
        let info = AppInfo(info: [:])
        #expect(info == AppInfo())
        #expect(!info.hasHelpLinks)
    }
}
