import Foundation
import Crypto

/// Formato do token de vínculo: 128 bits aleatórios em 32 caracteres hexadecimais minúsculos.
/// Hex porque o teclado do WhatsApp pode trocar a caixa das letras; o reconhecimento normaliza para minúsculo.
public enum LinkTokenCodec {
    public static let byteCount = 16
    public static let length = byteCount * 2

    /// Bytes do gerador do sistema (`SystemRandomNumberGenerator`: CSPRNG no Apple e no Linux).
    public static func systemRandomBytes(_ count: Int) -> [UInt8] {
        var generator = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    }

    public static func generate(randomBytes: (Int) -> [UInt8] = systemRandomBytes) -> String {
        hexString(randomBytes(byteCount))
    }

    /// SHA-256 do token em hexadecimal minúsculo. É o único valor persistido (`whatsapp_link_tokens.token_hash`).
    public static func hash(_ token: String) -> String {
        hexString(SHA256.hash(data: Data(token.lowercased().utf8)))
    }

    /// Primeira palavra do texto que tem o formato do token, normalizada para minúsculo.
    /// O texto é entrada não confiável; um falso positivo só gera uma consulta de hash sem resultado.
    public static func extract(from text: String) -> String? {
        for word in text.split(whereSeparator: { !$0.isLetter && !$0.isNumber }) {
            guard word.utf8.count == length, word.utf8.allSatisfy(isASCIIHexDigit) else { continue }
            return word.lowercased()
        }
        return nil
    }

    private static func isASCIIHexDigit(_ byte: UInt8) -> Bool {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "a")...UInt8(ascii: "f"), UInt8(ascii: "A")...UInt8(ascii: "F"): true
        default: false
        }
    }
}

func hexString<Bytes: Sequence>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
    let digits = Array("0123456789abcdef".utf8)
    var result: [UInt8] = []
    for byte in bytes {
        result.append(digits[Int(byte >> 4)])
        result.append(digits[Int(byte & 0x0f)])
    }
    return String(decoding: result, as: UTF8.self)
}
