import "server-only";
import { cookies } from "next/headers";
import { AuthError, CognitoClient, unverifiedClaims, type Tokens } from "./cognito/client";
import { serverConfig } from "./env";
import {
  ACCESS_COOKIE, PROFILE_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, profileFromIDClaims, seal, sealProfile, unseal,
  unsealProfile, type Profile,
} from "./session";

let client: CognitoClient | undefined;

export function cognito(): CognitoClient {
  if (client !== undefined) return client;
  const config = serverConfig();
  client = new CognitoClient({
    endpoint: config.cognitoEndpoint, clientID: config.clientID, userPoolID: config.userPoolID,
    fetch: async (url, init) => fetch(url, { ...init, cache: "no-store" }),
  });
  return client;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Cookie `Secure` sempre que o pedido veio por https (Vercel); em http://localhost (dev/e2e) não. */
export function isSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

export function writeTokens(store: CookieStore, tokens: Tokens, secure: boolean): void {
  const { sessionSecret } = serverConfig();
  store.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(secure, Math.max(60, tokens.expiresIn)));
  store.set(REFRESH_COOKIE, seal(sessionSecret, "refresh", tokens.refreshToken), cookieOptions(secure, REFRESH_MAX_AGE));
  store.set(PROFILE_COOKIE, sealProfile(sessionSecret, profileFromIDClaims(unverifiedClaims(tokens.idToken))), cookieOptions(secure, REFRESH_MAX_AGE));
}

export function clearSession(store: CookieStore): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, PROFILE_COOKIE]) store.delete(name);
}

export function refreshTokenFrom(store: CookieStore): string | null {
  const sealed = store.get(REFRESH_COOKIE)?.value;
  return sealed === undefined ? null : unseal(serverConfig().sessionSecret, "refresh", sealed);
}

export function profileFrom(store: CookieStore): Profile | null {
  return unsealProfile(serverConfig().sessionSecret, store.get(PROFILE_COOKIE)?.value);
}

function expiresSoon(token: string, now = Date.now()): boolean {
  const exp = unverifiedClaims(token)["exp"];
  return typeof exp !== "number" || exp * 1000 - now < 30_000;
}

/** Access token válido: o do cookie ou um renovado agora. `null` = sem sessão (o chamador responde 401). */
export async function accessToken(store: CookieStore, secure: boolean, force = false): Promise<string | null> {
  const current = store.get(ACCESS_COOKIE)?.value;
  if (!force && current !== undefined && !expiresSoon(current)) return current;
  const refresh = refreshTokenFrom(store);
  if (refresh === null) return null;
  try {
    const tokens = await cognito().refresh(refresh);
    writeTokens(store, tokens, secure);
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof AuthError && error.code !== "unavailable") clearSession(store);
    return null;
  }
}

/** Há sessão (pode precisar de refresh)? Usado pelas páginas para decidir o redirecionamento. */
export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE) !== undefined;
}
