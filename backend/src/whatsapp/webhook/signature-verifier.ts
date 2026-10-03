import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/** Valida o cabeçalho `X-Hub-Signature-256` (`sha256=<hex>`): HMAC-SHA256 do corpo bruto com o App Secret da Meta. */
export class SignatureVerifier {
  private readonly secret: Buffer | null;

  /** Com segredo vazio, nenhuma assinatura é válida (falha fechada). */
  constructor(appSecret: string) {
    this.secret = appSecret === "" ? null : Buffer.from(appSecret, "utf8");
  }

  isValid(signatureHeader: string | null | undefined, body: Uint8Array): boolean {
    if (this.secret === null || signatureHeader === null || signatureHeader === undefined) return false;
    if (!signatureHeader.startsWith(PREFIX)) return false;
    const provided = bytesFromHex(signatureHeader.slice(PREFIX.length));
    if (provided === null) return false;
    const expected = createHmac("sha256", this.secret).update(body).digest();
    // O tamanho do HMAC é público (32 bytes); o conteúdo é comparado em tempo constante.
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
}

function bytesFromHex(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

/** Comparação sem saída antecipada, para segredos como o `VERIFY_TOKEN`. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  const length = Math.max(left.length, right.length);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  const sameContent = timingSafeEqual(paddedLeft, paddedRight);
  return sameContent && left.length === right.length;
}
