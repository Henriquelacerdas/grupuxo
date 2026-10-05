import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";
import type { Instant } from "../domain/dates.ts";
import type { HttpFetch } from "../http.ts";
import { TokenVerifierUnavailableError } from "./token-verifier.ts";

/** Chave pública RSA de assinatura, identificada pelo `kid` do cabeçalho do JWT. */
export interface VerificationKey {
  readonly kid: string;
  readonly publicKey: KeyObject;
}

/** De onde vêm as chaves públicas (JWKS). Lança qualquer erro se não conseguir um conjunto utilizável. */
export interface JwksSource {
  load(): Promise<readonly VerificationKey[]>;
}

export class JwksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwksError";
  }
}

const MIN_MODULUS_BITS = 2048;
const MAX_JWKS_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/**
 * Converte o corpo de um `jwks.json` em chaves. Entradas que não servem (não RSA, `use` ou `alg` diferentes de
 * assinatura RS256, sem `kid`, módulo menor que 2048 bits, JWK inválido) são ignoradas; `kid` repetido ou
 * nenhuma chave utilizável tornam o conjunto inteiro inválido (falha fechada).
 */
export function parseJwks(body: unknown): VerificationKey[] {
  const entries = isRecord(body) ? field(body, "keys") : undefined;
  if (!Array.isArray(entries)) throw new JwksError("JWKS sem lista de chaves");
  const keys: VerificationKey[] = [];
  const seen = new Set<string>();
  const list: readonly unknown[] = entries;
  for (const entry of list) {
    const key = parseKey(entry);
    if (key === null) continue;
    if (seen.has(key.kid)) throw new JwksError("JWKS com kid repetido");
    seen.add(key.kid);
    keys.push(key);
  }
  if (keys.length === 0) throw new JwksError("JWKS sem chave utilizável");
  return keys;
}

function parseKey(entry: unknown): VerificationKey | null {
  if (!isRecord(entry)) return null;
  const kid = field(entry, "kid");
  const n = field(entry, "n");
  const e = field(entry, "e");
  const use = field(entry, "use");
  const alg = field(entry, "alg");
  if (field(entry, "kty") !== "RSA") return null;
  if (typeof kid !== "string" || kid === "" || kid.length > 256) return null;
  if (typeof n !== "string" || typeof e !== "string") return null;
  if (use !== undefined && use !== "sig") return null;
  if (alg !== undefined && alg !== "RS256") return null;
  try {
    const jwk: JsonWebKey = { kty: "RSA", n, e };
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    return publicKey.asymmetricKeyType === "rsa" && bits >= MIN_MODULUS_BITS ? { kid, publicKey } : null;
  } catch {
    return null;
  }
}

/** Busca `<issuer>/.well-known/jwks.json` por HTTPS. A URL vem de configuração, nunca do token. */
export class HttpJwksSource implements JwksSource {
  private readonly url: string;
  private readonly http: HttpFetch;
  private readonly timeoutMs: number;

  constructor(url: string, http: HttpFetch, timeoutMs = 5_000) {
    if (!url.startsWith("https://")) throw new JwksError("a URL do JWKS precisa ser HTTPS");
    this.url = url;
    this.http = http;
    this.timeoutMs = timeoutMs;
  }

  async load(): Promise<readonly VerificationKey[]> {
    const response = await this.http(this.url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // Mensagens de erro nunca carregam o corpo da resposta.
    if (!response.ok) throw new JwksError(`JWKS respondeu ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_JWKS_BYTES) throw new JwksError("JWKS grande demais");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new JwksError("JWKS não é JSON");
    }
    return parseJwks(body);
  }
}

export interface JwksCacheOptions {
  /** Quanto tempo o conjunto vale antes de ser buscado de novo. Padrão: 1 hora. */
  readonly ttlMs?: number;
  /** Intervalo mínimo entre buscas (inclusive as provocadas por `kid` desconhecido). Padrão: 10 s. */
  readonly minRefetchIntervalMs?: number;
}

/**
 * Cache das chaves com TTL. Um `kid` desconhecido provoca uma nova busca (rotação de chaves), mas no máximo
 * uma por `minRefetchIntervalMs`: quem forja tokens com `kid` aleatório não consegue transformar a `api` num
 * gerador de requisições ao Cognito. Buscas concorrentes são unificadas.
 */
export class JwksKeyResolver {
  private readonly source: JwksSource;
  private readonly now: () => Instant;
  private readonly ttlMs: number;
  private readonly minRefetchIntervalMs: number;
  private keys: ReadonlyMap<string, KeyObject> | null = null;
  private loadedAt: Instant = 0;
  private lastAttemptAt: Instant | null = null;
  private inflight: Promise<void> | null = null;

  constructor(source: JwksSource, now: () => Instant, options: JwksCacheOptions = {}) {
    this.source = source;
    this.now = now;
    this.ttlMs = options.ttlMs ?? 3_600_000;
    this.minRefetchIntervalMs = options.minRefetchIntervalMs ?? 10_000;
  }

  /** A chave de `kid`, ou `null` se ela não existir. Lança `TokenVerifierUnavailableError` sem conjunto válido. */
  async keyFor(kid: string): Promise<KeyObject | null> {
    const cached = this.fresh();
    if (cached === null) {
      await this.refresh();
      const loaded = this.fresh();
      if (loaded === null) throw new TokenVerifierUnavailableError();
      return loaded.get(kid) ?? null;
    }
    const known = cached.get(kid);
    if (known !== undefined) return known;
    try {
      await this.refresh();
    } catch (error) {
      // Rotação não confirmada: o conjunto em cache continua válido, e este `kid` segue desconhecido.
      if (!(error instanceof TokenVerifierUnavailableError)) throw error;
    }
    return (this.fresh() ?? cached).get(kid) ?? null;
  }

  private fresh(): ReadonlyMap<string, KeyObject> | null {
    return this.keys !== null && this.now() - this.loadedAt < this.ttlMs ? this.keys : null;
  }

  private refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    const now = this.now();
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < this.minRefetchIntervalMs) return Promise.resolve();
    this.lastAttemptAt = now;
    this.inflight = this.fetchKeys(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchKeys(at: Instant): Promise<void> {
    let loaded: readonly VerificationKey[];
    try {
      loaded = await this.source.load();
    } catch {
      throw new TokenVerifierUnavailableError();
    }
    this.keys = new Map(loaded.map((key) => [key.kid, key.publicKey]));
    this.loadedAt = at;
  }
}
