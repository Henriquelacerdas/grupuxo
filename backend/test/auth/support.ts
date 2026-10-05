import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { cognitoIssuer } from "../../src/auth/cognito-jwt-verifier.ts";
import type { JwksSource, VerificationKey } from "../../src/auth/jwks.ts";

export const USER_POOL_ID = "us-east-1_M9GpISkE3";
export const CLIENT_ID = "21gqeeehhmeufpipk84e3cc7tu";
export const ISSUER = cognitoIssuer(USER_POOL_ID);
export const SUB = "5b9c1e0a-3f4d-4a8e-9a77-0c2d6f1b8e11";
export const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
export const NOW_SECONDS = NOW / 1000;

export interface TestKey {
  readonly kid: string;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export function generateKey(kid: string, modulusLength = 2048): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength });
  return { kid, publicKey, privateKey };
}

export const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

export type Json = Readonly<Record<string, unknown>>;

export function accessClaims(overrides: Json = {}): Json {
  return {
    sub: SUB, iss: ISSUER, client_id: CLIENT_ID, token_use: "access", scope: "aws.cognito.signin.user.admin",
    iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 3600, jti: "d4b1f6a0", username: SUB, ...overrides,
  };
}

/** Remove claims de um objeto (um valor `undefined` em `overrides` ainda deixaria a chave presente). */
export function without(claims: Json, ...names: string[]): Json {
  return Object.fromEntries(Object.entries(claims).filter(([name]) => !names.includes(name)));
}

export function idClaims(overrides: Json = {}): Json {
  return without(accessClaims({ token_use: "id", aud: CLIENT_ID, email: "ana@example.com", "cognito:username": SUB, ...overrides }), "client_id", "scope", "username");
}

export interface SignOptions {
  readonly key: TestKey;
  readonly claims?: Json;
  readonly header?: Json;
}

/** Monta um JWT RS256 assinado com a chave privada de `options.key`. */
export function signJWT(options: SignOptions): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: options.key.kid, ...options.header }));
  const payload = base64url(JSON.stringify(options.claims ?? accessClaims()));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), options.key.privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Token com cabeçalho e payload arbitrários e a assinatura dada (já em base64url). */
export function rawJWT(header: Json, claims: Json, signature: string): string {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}.${signature}`;
}

/** Ataque de confusão de algoritmo: HS256 com a chave pública (em PEM) como segredo HMAC. */
export function hs256WithPublicKey(key: TestKey): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: key.kid }));
  const payload = base64url(JSON.stringify(accessClaims()));
  const secret = key.publicKey.export({ type: "spki", format: "pem" });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Troca um segmento do token (0 = cabeçalho, 1 = payload, 2 = assinatura). */
export function replaceSegment(token: string, index: number, value: string): string {
  return token.split(".").map((segment, i) => (i === index ? value : segment)).join(".");
}

/** Fonte de JWKS falsa: conta as buscas e permite trocar o conjunto (rotação) ou falhar. */
export class FakeJwksSource implements JwksSource {
  loads = 0;
  failing = false;
  private keys: readonly TestKey[];

  constructor(keys: readonly TestKey[]) {
    this.keys = keys;
  }

  rotate(keys: readonly TestKey[]): void {
    this.keys = keys;
  }

  async load(): Promise<readonly VerificationKey[]> {
    this.loads += 1;
    if (this.failing) throw new Error("falha simulada");
    return this.keys.map((key) => ({ kid: key.kid, publicKey: key.publicKey }));
  }
}
