import { createHash, createHmac, getDiffieHellman, randomBytes } from "node:crypto";

// Lado servidor do SRP-6a no sabor do Cognito (o mesmo que o `amazon-cognito-identity-js` e o Amplify usam), só
// para o emulador local. Grupo de 3072 bits do RFC 3526 (`modp15`), g = 2, chave derivada por HKDF ("Caldera
// Derived Key"). Implementação independente da do cliente (`web/src/server/cognito/srp.ts`): se as duas
// discordarem, o login local falha e o teste e2e acusa.

export const N = BigInt(`0x${getDiffieHellman("modp15").getPrime("hex")}`);
export const g = 2n;

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** Hexadecimal com o tamanho par e um `00` na frente quando o primeiro nibble tem o bit alto (número positivo). */
export function padHex(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  else if ("89abcdef".includes(hex[0] ?? "0")) hex = `00${hex}`;
  return hex;
}

const hexHash = (hex: string): string => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const textHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const k = BigInt(`0x${hexHash(`${padHex(N)}${padHex(g)}`)}`);

export interface SrpVerifier {
  readonly salt: string;
  readonly verifier: bigint;
}

/** Verificador guardado no cadastro: v = g^x, x = H(sal | H(pool + usuário + ":" + senha)). */
export function makeVerifier(poolName: string, userID: string, password: string): SrpVerifier {
  const salt = padHex(BigInt(`0x${randomBytes(16).toString("hex")}`));
  const x = BigInt(`0x${hexHash(`${salt}${textHash(`${poolName}${userID}:${password}`)}`)}`);
  return { salt, verifier: modPow(g, x, N) };
}

export interface ServerChallenge {
  readonly b: bigint;
  readonly B: bigint;
}

export function serverChallenge(verifier: bigint): ServerChallenge {
  const b = BigInt(`0x${randomBytes(128).toString("hex")}`);
  const B = (k * verifier + modPow(g, b, N)) % N;
  return { b, B };
}

function hkdf(ikm: Buffer, salt: Buffer): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([Buffer.from("Caldera Derived Key", "utf8"), Buffer.from([1])])).digest().subarray(0, 16);
}

/** Assinatura que o cliente tem de mandar em `PASSWORD_CLAIM_SIGNATURE`; `null` se `A` for inválido. */
export function expectedSignature(options: {
  readonly A: bigint; readonly challenge: ServerChallenge; readonly verifier: bigint;
  readonly poolName: string; readonly userID: string; readonly secretBlock: Buffer; readonly timestamp: string;
}): string | null {
  const { A, challenge, verifier } = options;
  if (A % N === 0n) return null;
  const u = BigInt(`0x${hexHash(`${padHex(A)}${padHex(challenge.B)}`)}`);
  if (u === 0n) return null;
  const S = modPow(A * modPow(verifier, u, N), challenge.b, N);
  const key = hkdf(Buffer.from(padHex(S), "hex"), Buffer.from(padHex(u), "hex"));
  return createHmac("sha256", key)
    .update(Buffer.concat([
      Buffer.from(options.poolName, "utf8"), Buffer.from(options.userID, "utf8"), options.secretBlock, Buffer.from(options.timestamp, "utf8"),
    ]))
    .digest("base64");
}
