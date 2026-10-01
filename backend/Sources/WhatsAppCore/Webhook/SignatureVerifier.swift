import Foundation
import Crypto

/// Valida o cabeçalho `X-Hub-Signature-256` (`sha256=<hex>`): HMAC-SHA256 do corpo bruto com o App Secret da Meta.
public struct SignatureVerifier: Sendable {
    // `Data` em vez de `SymmetricKey`: no swift-crypto (Linux) a chave não é `Sendable`.
    private let secret: Data?

    /// Com segredo vazio, nenhuma assinatura é válida (falha fechada).
    public init(appSecret: String) {
        secret = appSecret.isEmpty ? nil : Data(appSecret.utf8)
    }

    public func isValid(signatureHeader: String?, body: Data) -> Bool {
        guard let secret,
              let header = signatureHeader,
              header.hasPrefix(Self.prefix),
              let provided = Self.bytes(fromHex: String(header.dropFirst(Self.prefix.count)))
        else { return false }
        return HMAC<SHA256>.isValidAuthenticationCode(provided, authenticating: body, using: SymmetricKey(data: secret))
    }

    private static let prefix = "sha256="

    private static func bytes(fromHex hex: String) -> [UInt8]? {
        let digits = Array(hex.utf8)
        guard !digits.isEmpty, digits.count.isMultiple(of: 2) else { return nil }
        var result: [UInt8] = []
        result.reserveCapacity(digits.count / 2)
        for index in stride(from: 0, to: digits.count, by: 2) {
            guard let high = nibble(digits[index]), let low = nibble(digits[index + 1]) else { return nil }
            result.append(high << 4 | low)
        }
        return result
    }

    private static func nibble(_ character: UInt8) -> UInt8? {
        switch character {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): character - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): character - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): character - UInt8(ascii: "A") + 10
        default: nil
        }
    }
}

/// Comparação sem saída antecipada, para segredos como o `VERIFY_TOKEN`.
func constantTimeEquals(_ lhs: String, _ rhs: String) -> Bool {
    let left = Array(lhs.utf8)
    let right = Array(rhs.utf8)
    var difference = left.count ^ right.count
    for index in 0..<max(left.count, right.count) {
        let a = index < left.count ? left[index] : 0
        let b = index < right.count ? right[index] : 0
        difference |= Int(a ^ b)
    }
    return difference == 0
}
