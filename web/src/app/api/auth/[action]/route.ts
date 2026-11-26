import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isRecord } from "@/lib/api/decode";
import { AuthError } from "@/server/cognito/client";
import { accessToken, clearSession, cognito, isSecure, profileFrom, refreshTokenFrom, writeTokens } from "@/server/auth";
import { sameOriginRequest } from "@/server/csrf";
import { RateLimiter } from "@/server/rate-limit";
import { hashedClientKey } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rotas de conta do BFF. Respostas: `204`, `200 {…}` ou `{ "error": "<código>" }` (nunca a mensagem do Cognito).
const limiter = new RateLimiter(20, 60_000);

function error(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

function ok(body?: Record<string, unknown>): NextResponse {
  return body === undefined ? new NextResponse(null, { status: 204 }) : NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

function text(body: Record<string, unknown>, name: string, max = 256): string | null {
  const value = body[name];
  if (typeof value !== "string" || value.length === 0 || value.length > max) return null;
  return value;
}

/** E-mail aparado e em minúsculas, como o `AuthService` do app. */
function email(body: Record<string, unknown>): string | null {
  const value = text(body, "email", 254)?.trim().toLowerCase() ?? null;
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

const status: Readonly<Record<string, number>> = {
  invalid_credentials: 401, user_not_confirmed: 403, username_exists: 409, invalid_password: 400, code_mismatch: 400,
  expired_code: 400, limit_exceeded: 429, user_not_found: 404, invalid_parameter: 400, unavailable: 503,
  session_expired: 401, unsupported_challenge: 400, already_confirmed: 409,
};

export async function GET(request: Request, context: { params: Promise<{ action: string }> }): Promise<NextResponse> {
  const { action } = await context.params;
  if (action !== "session") return error(404, "not_found");
  const store = await cookies();
  const token = await accessToken(store, isSecure(request));
  if (token === null) return ok({ signedIn: false });
  const profile = profileFrom(store);
  return ok({ signedIn: true, email: profile?.email ?? "", provider: profile?.provider ?? "password" });
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }): Promise<NextResponse> {
  const { action } = await context.params;
  const url = new URL(request.url);
  if (!sameOriginRequest("POST", url, request.headers)) return error(403, "forbidden");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!limiter.allow(`${hashedClientKey(ip)}:${action}`)) return error(429, "limit_exceeded");

  let body: Record<string, unknown> = {};
  const raw = await request.text();
  if (raw.length > 4096) return error(400, "bad_request");
  if (raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return error(400, "bad_request");
      body = parsed;
    } catch {
      return error(400, "bad_request");
    }
  }

  const store = await cookies();
  const secure = isSecure(request);
  try {
    switch (action) {
      case "sign-in": {
        const address = email(body);
        const password = text(body, "password");
        if (address === null || password === null) return error(400, "invalid_parameter");
        clearSession(store);
        writeTokens(store, await cognito().signIn(address, password), secure);
        return ok();
      }
      case "sign-up": {
        const address = email(body);
        const password = text(body, "password");
        if (address === null || password === null) return error(400, "invalid_parameter");
        const result = await cognito().signUp(address, password);
        return ok({ confirmed: result.confirmed });
      }
      case "confirm": {
        const address = email(body);
        const code = text(body, "code", 16)?.trim() ?? null;
        if (address === null || code === null) return error(400, "invalid_parameter");
        await cognito().confirmSignUp(address, code);
        return ok();
      }
      case "resend": {
        const address = email(body);
        if (address === null) return error(400, "invalid_parameter");
        await cognito().resendCode(address);
        return ok();
      }
      case "forgot": {
        const address = email(body);
        if (address === null) return error(400, "invalid_parameter");
        await cognito().forgotPassword(address);
        return ok();
      }
      case "reset": {
        const address = email(body);
        const code = text(body, "code", 16)?.trim() ?? null;
        const password = text(body, "password");
        if (address === null || code === null || password === null) return error(400, "invalid_parameter");
        await cognito().confirmForgotPassword(address, code, password);
        return ok();
      }
      case "change-password": {
        const previous = text(body, "currentPassword");
        const proposed = text(body, "newPassword");
        if (previous === null || proposed === null) return error(400, "invalid_parameter");
        const token = await accessToken(store, secure);
        if (token === null) return error(401, "unauthorized");
        await cognito().changePassword(token, previous, proposed);
        return ok();
      }
      case "sign-out": {
        const refresh = refreshTokenFrom(store);
        clearSession(store);
        if (refresh !== null) await cognito().revoke(refresh).catch(() => undefined);
        return ok();
      }
      default:
        return error(404, "not_found");
    }
  } catch (caught) {
    if (caught instanceof AuthError) return error(status[caught.code] ?? 400, caught.code);
    return error(500, "internal");
  }
}
