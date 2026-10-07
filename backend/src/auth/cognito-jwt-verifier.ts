import { verify } from "node:crypto";
import type { Instant } from "../domain/dates.ts";
import { JwksKeyResolver, type JwksSource } from "./jwks.ts";
import {
  AuthenticationError, TokenVerifierUnavailableError, parseCognitoSub,
  type AuthenticationFailure, type TokenVerifier, type VerifiedToken,
} from "./token-verifier.ts";

/** Valores de `token_use` que a `api` aceita. Hoje só o access token; o ID token é rejeitado de propósito. */
export type AcceptedTokenUse = "access";

export type CognitoConfigErrorCode = "invalidUserPoolID" | "invalidClientID" | "invalidTokenUse" | "invalidTolerance";

export class CognitoConfigError extends Error {
  readonly code: CognitoConfigErrorCode;

  constructor(code: CognitoConfigErrorCode) {
    super(code);
    this.name = "CognitoConfigError";
    this.code = code;
  }
}

export interface CognitoVerifierConfig {
  /** Ex.: `us-east-1_M9GpISkE3` (valor público, em `amplify_outputs.json`). A região sai do prefixo. */
  readonly userPoolID: string;
  /** `user_pool_client_id` do app (valor público). Comparado com o claim `client_id`, nunca com `aud`. */
  readonly clientID: string;
  /** Padrão e único valor suportado: `["access"]`. */
  readonly acceptedTokenUse?: readonly AcceptedTokenUse[];
  /** Tolerância de relógio em `exp` e `nbf`. Padrão: 30 s; máximo: 300 s. */
  readonly clockToleranceSeconds?: number;
  /** Tamanho máximo do token em caracteres. Padrão: 8192 (um access token do Cognito tem ~1 KB). */
  readonly maxTokenLength?: number;
}

const USER_POOL_PATTERN = /^([a-z]{2}(?:-[a-z]+)+-[0-9])_[A-Za-z0-9]+$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_KID_LENGTH = 256;

/** `https://cognito-idp.<região>.amazonaws.com/<pool>`, exatamente o `iss` que o Cognito emite. */
export function cognitoIssuer(userPoolID: string): string {
  const match = USER_POOL_PATTERN.exec(userPoolID);
  if (match === null) throw new CognitoConfigError("invalidUserPoolID");
  return `https://cognito-idp.${match[1]}.amazonaws.com/${userPoolID}`;
}

export function cognitoJwksURL(userPoolID: string): string {
  return `${cognitoIssuer(userPoolID)}/.well-known/jwks.json`;
}

export interface CognitoVerifierDependencies {
  readonly jwks: JwksSource;
  /** Relógio injetado (milissegundos desde a época Unix). */
  readonly now: () => Instant;
  /** Veja `JwksKeyResolver`. */
  readonly jwksTtlMs?: number;
  readonly jwksMinRefetchIntervalMs?: number;
}

type Claims = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Claims {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: Claims, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/**
 * Valida o access token do Cognito: RS256 com a chave do JWKS do pool, `iss`, `token_use`, `client_id`,
 * `exp` e `nbf`. A assinatura é conferida antes de qualquer claim ser considerada. Não há caminho que
 * aceite um token sem ter passado em todas as regras.
 */
export class CognitoJwtVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly clientID: string;
  private readonly acceptedTokenUse: readonly AcceptedTokenUse[];
  private readonly toleranceSeconds: number;
  private readonly maxTokenLength: number;
  private readonly now: () => Instant;
  private readonly keys: JwksKeyResolver;

  constructor(config: CognitoVerifierConfig, dependencies: CognitoVerifierDependencies) {
    this.issuer = cognitoIssuer(config.userPoolID);
    if (!CLIENT_ID_PATTERN.test(config.clientID)) throw new CognitoConfigError("invalidClientID");
    const accepted = config.acceptedTokenUse ?? ["access"];
    if (accepted.length === 0 || accepted.some((use) => use !== "access")) throw new CognitoConfigError("invalidTokenUse");
    const tolerance = config.clockToleranceSeconds ?? 30;
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 300) throw new CognitoConfigError("invalidTolerance");
    this.clientID = config.clientID;
    this.acceptedTokenUse = [...accepted];
    this.toleranceSeconds = tolerance;
    this.maxTokenLength = config.maxTokenLength ?? 8192;
    this.now = dependencies.now;
    this.keys = new JwksKeyResolver(dependencies.jwks, dependencies.now, {
      ...(dependencies.jwksTtlMs === undefined ? {} : { ttlMs: dependencies.jwksTtlMs }),
      ...(dependencies.jwksMinRefetchIntervalMs === undefined ? {} : { minRefetchIntervalMs: dependencies.jwksMinRefetchIntervalMs }),
    });
  }

  async verify(token: string): Promise<VerifiedToken> {
    try {
      return await this.verifyToken(token);
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof TokenVerifierUnavailableError) throw error;
      // Qualquer falha inesperada nega o acesso: nunca cai num caminho que aceite o token.
      throw new AuthenticationError("verificationFailed");
    }
  }

  private async verifyToken(token: string): Promise<VerifiedToken> {
    if (token.length > this.maxTokenLength) throw new AuthenticationError("tooLarge");
    const segments = token.split(".");
    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    if (segments.length !== 3 || encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
      throw new AuthenticationError("malformed");
    }

    // Primeiro a estrutura dos três segmentos; só depois o que o cabeçalho diz.
    const header = decodeJSON(encodedHeader);
    const payload = decodeJSON(encodedPayload);
    const signature = decodeBase64URL(encodedSignature);

    if (field(header, "alg") !== "RS256") throw new AuthenticationError("unsupportedAlgorithm");
    // `crit` lista extensões que o verificador teria de entender (RFC 7515); não entendemos nenhuma.
    if (Object.hasOwn(header, "crit")) throw new AuthenticationError("malformed");
    const kid = field(header, "kid");
    if (typeof kid !== "string" || kid === "" || kid.length > MAX_KID_LENGTH) throw new AuthenticationError("malformed");
    const publicKey = await this.keys.keyFor(kid);
    if (publicKey === null) throw new AuthenticationError("unknownKey");
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
    if (!verify("sha256", signingInput, publicKey, signature)) throw new AuthenticationError("badSignature");

    return this.checkClaims(payload);
  }

  private checkClaims(claims: Claims): VerifiedToken {
    fail(field(claims, "iss") !== this.issuer, "wrongIssuer");
    const tokenUse = field(claims, "token_use");
    fail(!this.acceptedTokenUse.some((use) => use === tokenUse), "wrongTokenUse");
    // O access token do Cognito traz `client_id`; `aud` só existe no ID token e não é consultado.
    fail(field(claims, "client_id") !== this.clientID, "wrongClient");

    const nowSeconds = this.now() / 1000;
    const exp = field(claims, "exp");
    if (typeof exp !== "number" || !Number.isFinite(exp)) throw new AuthenticationError("invalidClaims");
    fail(nowSeconds >= exp + this.toleranceSeconds, "expired");
    const nbf = field(claims, "nbf");
    if (nbf !== undefined) {
      if (typeof nbf !== "number" || !Number.isFinite(nbf)) throw new AuthenticationError("invalidClaims");
      fail(nowSeconds + this.toleranceSeconds < nbf, "notYetValid");
    }

    const sub = field(claims, "sub");
    const cognitoSub = typeof sub === "string" ? parseCognitoSub(sub) : null;
    if (cognitoSub === null) throw new AuthenticationError("invalidClaims");
    return { cognitoSub };
  }
}

function fail(condition: boolean, reason: AuthenticationFailure): void {
  if (condition) throw new AuthenticationError(reason);
}

/** Base64url sem preenchimento, com o alfabeto estrito (nada de `+`, `/`, `=` nem espaços). */
function decodeBase64URL(segment: string): Buffer {
  if (!SEGMENT_PATTERN.test(segment) || segment.length % 4 === 1) throw new AuthenticationError("malformed");
  return Buffer.from(segment, "base64url");
}

function decodeJSON(segment: string): Claims {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64URL(segment)));
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError("malformed");
  }
  if (!isRecord(value)) throw new AuthenticationError("malformed");
  return value;
}
