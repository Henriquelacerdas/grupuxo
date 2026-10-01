import Foundation
import Testing
@testable import WhatsAppCore

struct SignatureVerifierTests {
    let verifier = SignatureVerifier(appSecret: Fixtures.appSecret)
    let body = Data(#"{"hello":"world"}"#.utf8)

    @Test func acceptsSignatureComputedByOpenSSL() {
        // printf '{"hello":"world"}' | openssl dgst -sha256 -hmac "segredo-do-app"
        let header = "sha256=e0e1b665be99797fb88f0868d687b3015590c90a431ad1ebad14ba49ecb65337"
        #expect(verifier.isValid(signatureHeader: header, body: body))
        #expect(verifier.isValid(signatureHeader: header.uppercased().replacingOccurrences(of: "SHA256=", with: "sha256="), body: body))
    }

    @Test func rejectsTamperedBodyWrongSecretAndMalformedHeaders() {
        let valid = Fixtures.sign(body)
        #expect(verifier.isValid(signatureHeader: valid, body: body))
        #expect(!verifier.isValid(signatureHeader: valid, body: Data(#"{"hello":"mundo"}"#.utf8)))
        #expect(!verifier.isValid(signatureHeader: Fixtures.sign(body, secret: "outro"), body: body))
        #expect(!verifier.isValid(signatureHeader: nil, body: body))
        #expect(!verifier.isValid(signatureHeader: "", body: body))
        #expect(!verifier.isValid(signatureHeader: "sha256=", body: body))
        #expect(!verifier.isValid(signatureHeader: "sha256=zz", body: body))
        #expect(!verifier.isValid(signatureHeader: "sha256=abc", body: body))
        #expect(!verifier.isValid(signatureHeader: String(valid.dropFirst(7)), body: body))
        #expect(!verifier.isValid(signatureHeader: "sha1" + valid.dropFirst(6), body: body))
    }

    @Test func emptySecretFailsClosed() {
        let empty = SignatureVerifier(appSecret: "")
        #expect(!empty.isValid(signatureHeader: Fixtures.sign(body, secret: ""), body: body))
    }

    @Test func constantTimeEqualsComparesContentAndLength() {
        #expect(constantTimeEquals("abc", "abc"))
        #expect(constantTimeEquals("", ""))
        #expect(!constantTimeEquals("abc", "abd"))
        #expect(!constantTimeEquals("abc", "abcd"))
        #expect(!constantTimeEquals("abc", ""))
    }
}
