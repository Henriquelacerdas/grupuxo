import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accessToken, clearSession, isSecure } from "./auth";
import { sameOriginRequest } from "./csrf";
import { serverConfig } from "./env";

// Proxy `/api/v1/*` → `api` `/v1/*`. Põe o Bearer do cookie, renova uma vez num 401, repassa status e corpo
// (`{ "error" }` incluso) sem alterar. Nunca repassa cookies nem registra token ou corpo.

const PATH = /^\/v1(\/[a-z0-9-]+)+$/;
const QUERY = /^[A-Za-z0-9=&%._~+-]*$/;
export const MAX_BODY = 4096;

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly body?: string;
}

/** Chamada autenticada à `api` com o token da sessão; usada pelo proxy e pela rota da foto. */
export async function callApi(request: Request, call: ApiCall): Promise<Response | null> {
  const store = await cookies();
  const secure = isSecure(request);
  const { apiBaseURL } = serverConfig();
  const target = `${apiBaseURL}${call.path}${call.query ? `?${call.query}` : ""}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(store, secure, attempt === 1);
    if (token === null) {
      clearSession(store);
      return null;
    }
    const response = await fetch(target, {
      method: call.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(call.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(call.body === undefined ? {} : { body: call.body }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 401 || attempt === 1) {
      if (response.status === 401) clearSession(store);
      return response;
    }
  }
  return null;
}

export async function proxy(request: Request, segments: readonly string[]): Promise<NextResponse> {
  const url = new URL(request.url);
  if (!sameOriginRequest(request.method, url, request.headers)) return json(403, { error: "forbidden" });
  const path = `/v1/${segments.join("/")}`;
  const query = url.search.replace(/^\?/, "");
  if (!PATH.test(path) || !QUERY.test(query)) return json(404, { error: "not_found" });

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "DELETE") {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(400, { error: "bad_request" });
    if (text.length > 0) body = text;
  }

  let response: Response | null;
  try {
    response = await callApi(request, { method: request.method, path, query, ...(body === undefined ? {} : { body }) });
  } catch {
    return json(503, { error: "unavailable" });
  }
  if (response === null) return json(401, { error: "unauthorized" });
  const text = response.status === 204 ? null : await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
