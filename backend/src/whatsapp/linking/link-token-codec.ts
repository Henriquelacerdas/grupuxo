import { createHash, randomBytes as systemRandom } from "node:crypto";

/**
 * Formato do token de vínculo: 128 bits aleatórios em 32 caracteres hexadecimais minúsculos. Hex porque o
 * teclado do WhatsApp pode trocar a caixa das letras; o reconhecimento normaliza para minúsculo.
 */
export const TOKEN_BYTE_COUNT = 16;
export const TOKEN_LENGTH = TOKEN_BYTE_COUNT * 2;

export type RandomBytes = (count: number) => Uint8Array;

/** Bytes do gerador do sistema (CSPRNG). */
export const systemRandomBytes: RandomBytes = (count) => systemRandom(count);

export function generateToken(randomBytes: RandomBytes = systemRandomBytes): string {
  return Buffer.from(randomBytes(TOKEN_BYTE_COUNT)).toString("hex");
}

/** SHA-256 do token em hexadecimal minúsculo: o único valor persistido (`whatsapp_link_tokens.token_hash`). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token.toLowerCase(), "utf8").digest("hex");
}

/**
 * Primeira palavra do texto com o formato do token, normalizada para minúsculo. O texto é entrada não
 * confiável; um falso positivo só gera uma consulta de hash sem resultado. Marcas combinantes contam como parte
 * da palavra (um caractere acentuado é uma letra), como no `split` por `Character` do Swift.
 */
export function extractToken(text: string): string | null {
  for (const word of text.split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (/^[0-9a-fA-F]{32}$/.test(word)) return word.toLowerCase();
  }
  return null;
}
