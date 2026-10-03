import Testing
import WhatsAppCore

struct LinkTokenCodecTests {
    let token = "0123456789abcdef0123456789abcdef"

    @Test func generatedTokenHas128BitsAsLowercaseHex() {
        let generated = LinkTokenCodec.generate()
        #expect(generated.count == 32)
        #expect(generated.allSatisfy { "0123456789abcdef".contains($0) })
    }

    @Test func generatedTokensDiffer() {
        #expect(LinkTokenCodec.generate() != LinkTokenCodec.generate())
    }

    @Test func generateEncodesTheRandomBytes() {
        #expect(LinkTokenCodec.generate { count in (0..<count).map { UInt8($0 * 17) } } == "00112233445566778899aabbccddeeff")
    }

    @Test func hashIsSha256HexOfTheLowercasedToken() {
        // Vetor conhecido: SHA-256("abc").
        #expect(LinkTokenCodec.hash("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(LinkTokenCodec.hash(token.uppercased()) == LinkTokenCodec.hash(token))
    }

    @Test func extractFindsTokenInPrefilledMessageAndNormalizesCase() {
        #expect(LinkTokenCodec.extract(from: "Conectar meu WhatsApp ao Grupuxo. Código: \(token)") == token)
        #expect(LinkTokenCodec.extract(from: "código: \(token.uppercased())!") == token)
        #expect(LinkTokenCodec.extract(from: "(\(token))") == token)
    }

    @Test func extractRejectsWrongLengthNonHexAndMissing() {
        #expect(LinkTokenCodec.extract(from: String(token.dropLast())) == nil)
        #expect(LinkTokenCodec.extract(from: token + "a") == nil)
        #expect(LinkTokenCodec.extract(from: String(token.dropLast()) + "g") == nil)
        #expect(LinkTokenCodec.extract(from: String(repeating: "０", count: 32)) == nil)
        #expect(LinkTokenCodec.extract(from: "quais são minhas tarefas?") == nil)
        #expect(LinkTokenCodec.extract(from: "") == nil)
    }

    @Test func extractReturnsTheFirstTokenShapedWord() {
        let other = "fedcba9876543210fedcba9876543210"
        #expect(LinkTokenCodec.extract(from: "\(token) \(other)") == token)
    }
}
