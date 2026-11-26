import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { isRecord } from "@/lib/api/decode";

// Cookies de sessão do BFF. O navegador nunca lê tokens (HttpOnly). O refresh token e o perfil vão cifrados
// (AES-256-GCM, chave derivada de SESSION_SECRET); o access token vai como está (curto, e é o que a `api` aceita).

export const ACCESS_COOKIE = "rvz_at";
export const REFRESH_COOKIE = "rvz_rt";
export const PROFILE_COOKIE = "rvz_me";
/** Refresh token do Cognito vale 30 dias por padrão; o cookie acompanha. */
export const REFRESH_MAX_AGE = 30 * 24 * 3600;

export interface Profile {
  readonly email: string;
  /** `password` ou o provedor externo do ID token (`identities[0].providerName`). */
  readonly provider: string;
}

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("reveza-web"), Buffer.from(purpose), 32));
}

export function seal(secret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** `null` para valor adulterado, de outra chave ou de outro propósito. */
export function unseal(secret: string, purpose: string, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function sealProfile(secret: string, profile: Profile): string {
  return seal(secret, "profile", JSON.stringify(profile));
}

export function unsealProfile(secret: string, sealed: string | undefined): Profile | null {
  if (sealed === undefined) return null;
  const text = unseal(secret, "profile", sealed);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || typeof value["email"] !== "string" || typeof value["provider"] !== "string") return null;
    return { email: value["email"], provider: value["provider"] };
  } catch {
    return null;
  }
}

/** Perfil a partir das claims do ID token (como `AccountIdentity` no app). */
export function profileFromIDClaims(claims: Record<string, unknown>): Profile {
  const email = typeof claims["email"] === "string" ? claims["email"] : "";
  let identities: unknown = claims["identities"];
  if (typeof identities === "string") {
    try { identities = JSON.parse(identities); } catch { identities = undefined; }
  }
  const first: unknown = Array.isArray(identities) ? identities[0] : undefined;
  const provider = isRecord(first) && typeof first["providerName"] === "string" ? first["providerName"] : "password";
  return { email, provider };
}

export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly maxAge: number;
}

export interface CookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly secure: boolean;
  readonly maxAge: number;
}

export function cookieOptions(secure: boolean, maxAge: number): CookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge };
}

/** Chave do limite de taxa sem guardar o IP em claro. */
export function hashedClientKey(ip: string): string {
  return createHash("sha256").update(ip).digest("base64url").slice(0, 22);
}
