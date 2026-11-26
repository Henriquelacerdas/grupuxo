import { createHash, createHmac, getDiffieHellman, randomBytes } from "node:crypto";

// Cliente SRP-6a do Cognito (`USER_SRP_AUTH`), o mesmo fluxo do Amplify no app: a senha nunca vai ao Cognito, só a
// prova. Grupo de 3072 bits do RFC 3526 (`modp15`), g = 2, k = H(N | g), chave = HKDF("Caldera Derived Key").
// Roda só no servidor (BFF).

const N = BigInt(`0x${getDiffieHellman("modp15").getPrime("hex")}`);
const g = 2n;

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

export function padHex(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  else if ("89abcdef".includes(hex.charAt(0))) hex = `00${hex}`;
  return hex;
}

const hashHex = (hex: string): string => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const hashText = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const k = BigInt(`0x${hashHex(`${padHex(N)}${padHex(g)}`)}`);

export interface SrpSession {
  readonly a: bigint;
  readonly A: bigint;
}

export function startSrp(random: (size: number) => Buffer = randomBytes): SrpSession {
  for (;;) {
    const a = BigInt(`0x${random(128).toString("hex")}`) % N;
    const A = modPow(g, a, N);
    if (A % N !== 0n && a !== 0n) return { a, A };
  }
}

export const srpAHex = (session: SrpSession): string => session.A.toString(16);

export class SrpError extends Error {
  constructor() {
    super("Desafio SRP inválido");
    this.name = "SrpError";
  }
}

function hkdf(ikm: Buffer, salt: Buffer): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([Buffer.from("Caldera Derived Key", "utf8"), Buffer.from([1])])).digest().subarray(0, 16);
}

/** `PASSWORD_CLAIM_SIGNATURE` para o desafio `PASSWORD_VERIFIER`. */
export function passwordClaim(options: {
  readonly session: SrpSession; readonly poolName: string; readonly userIDForSRP: string; readonly password: string;
  readonly saltHex: string; readonly srpBHex: string; readonly secretBlock: string; readonly timestamp: string;
}): string {
  const B = BigInt(`0x${options.srpBHex}`);
  if (B % N === 0n) throw new SrpError();
  const { a, A } = options.session;
  const u = BigInt(`0x${hashHex(`${padHex(A)}${padHex(B)}`)}`);
  if (u === 0n) throw new SrpError();
  const x = BigInt(`0x${hashHex(`${padHex(BigInt(`0x${options.saltHex}`))}${hashText(`${options.poolName}${options.userIDForSRP}:${options.password}`)}`)}`);
  const S = modPow(B - ((k * modPow(g, x, N)) % N), a + u * x, N);
  const key = hkdf(Buffer.from(padHex(S), "hex"), Buffer.from(padHex(u), "hex"));
  return createHmac("sha256", key)
    .update(Buffer.concat([
      Buffer.from(options.poolName, "utf8"), Buffer.from(options.userIDForSRP, "utf8"),
      Buffer.from(options.secretBlock, "base64"), Buffer.from(options.timestamp, "utf8"),
    ]))
    .digest("base64");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Tue Nov 26 12:00:00 UTC 2026`: dia sem zero à esquerda, como o Cognito exige. */
export function cognitoTimestamp(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${DAYS[at.getUTCDay()]} ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} UTC ${at.getUTCFullYear()}`;
}
