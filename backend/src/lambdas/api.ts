import { AuthenticationError, TokenVerifierUnavailableError, type TokenVerifier } from "../auth/token-verifier.ts";
import { parseProfileName, UserDirectoryError, type UserDirectory } from "../auth/user-directory.ts";
import type { UserID } from "../domain/ids.ts";
import type { WhatsAppLinker } from "../whatsapp/linking/whatsapp-linker.ts";
import { WhatsAppLinkError, type WhatsAppLink, type WhatsAppLinkStore } from "../whatsapp/ports.ts";
import { field, isRecord, parseHttpApiEvent, type Fields, type HttpApiRequest, type HttpApiResult } from "./events.ts";

export interface ApiDependencies {
  readonly verifier: TokenVerifier;
  readonly users: UserDirectory;
  readonly linker: Pick<WhatsAppLinker, "issueInvitation">;
  readonly links: Pick<WhatsAppLinkStore, "linkForUser" | "remove">;
}

const MAX_BODY_BYTES = 4096;

type Method = "GET" | "POST" | "DELETE";

/** Rotas da `api` sob `/v1` (BACKEND.md, seção 6). Método fora da lista de uma rota existente → 405. */
const ROUTES: Readonly<Record<string, readonly Method[]>> = {
  "/v1/me": ["POST"],
  "/v1/me/whatsapp/link": ["POST"],
  "/v1/me/whatsapp": ["GET", "DELETE"],
};

function json(statusCode: number, body: unknown, extra: Readonly<Record<string, string>> = {}): HttpApiResult {
  return { statusCode, headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) };
}

const failure = (statusCode: number, error: string, extra: Readonly<Record<string, string>> = {}): HttpApiResult =>
  json(statusCode, { error }, extra);

/** Telefone para exibir no app: `+5511999998888` vira `+55•••••••8888`. */
export function maskPhone(phoneE164: string): string {
  return `${phoneE164.slice(0, 3)}${"•".repeat(Math.max(0, phoneE164.length - 7))}${phoneE164.slice(-4)}`;
}

function bearerToken(request: HttpApiRequest): string | null {
  const header = request.headers["authorization"];
  if (header === undefined) return null;
  const match = /^bearer +(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** `null` se o corpo não for um objeto JSON em UTF-8 de até 4 KB. */
function jsonObject(body: Uint8Array): Fields | null {
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Lambda `api` (Function URL pública, payload 2.0; autorização feita aqui, a URL fica sem autenticação da AWS). O `userID` vem sempre do
 * access token do Cognito (via `UserDirectory`), nunca do corpo ou da URL. 401 não revela o motivo; 503 quando
 * as chaves do Cognito estão indisponíveis; erro inesperado vira 500 sem detalhe. Não registra nada em log.
 */
export function createApiHandler(deps: ApiDependencies): (event: unknown) => Promise<HttpApiResult> {
  return async (event) => {
    const request = parseHttpApiEvent(event);
    if (request === null) return failure(400, "bad_request");
    const methods = Object.hasOwn(ROUTES, request.path) ? ROUTES[request.path] : undefined;
    if (methods === undefined) return failure(404, "not_found");
    const method = request.method.toUpperCase();
    if (!methods.some((allowed) => allowed === method)) return failure(405, "method_not_allowed", { allow: methods.join(", ") });

    try {
      const token = bearerToken(request);
      if (token === null) return failure(401, "unauthorized");
      const { cognitoSub } = await deps.verifier.verify(token);
      return await route(deps, request.path, method, cognitoSub, request);
    } catch (error) {
      if (error instanceof AuthenticationError) return failure(401, "unauthorized");
      if (error instanceof TokenVerifierUnavailableError) return failure(503, "unavailable");
      return failure(500, "internal");
    }
  };
}

async function route(
  deps: ApiDependencies, path: string, method: string, cognitoSub: Parameters<UserDirectory["userForSub"]>[0], request: HttpApiRequest,
): Promise<HttpApiResult> {
  if (path === "/v1/me") {
    const body = jsonObject(request.body);
    const name = body === null ? undefined : field(body, "name");
    const profileName = typeof name === "string" ? parseProfileName(name) : null;
    if (profileName === null) return failure(400, "invalid_name");
    try {
      return json(200, { id: await deps.users.ensureUser(cognitoSub, { name: profileName }) });
    } catch (error) {
      if (error instanceof UserDirectoryError) return failure(400, "invalid_name");
      throw error;
    }
  }

  // As demais rotas exigem que a conta já tenha passado pelo `POST /v1/me`.
  const user = await deps.users.userForSub(cognitoSub);
  if (user === null) return failure(403, "account_not_registered");
  return whatsAppRoute(deps, path, method, user);
}

async function whatsAppRoute(deps: ApiDependencies, path: string, method: string, user: UserID): Promise<HttpApiResult> {
  if (path === "/v1/me/whatsapp/link") {
    try {
      const invitation = await deps.linker.issueInvitation(user);
      return json(200, { url: invitation.url, expiresAt: new Date(invitation.expiresAt).toISOString() });
    } catch (error) {
      if (error instanceof WhatsAppLinkError && error.code === "userAlreadyLinked") return failure(409, "already_linked");
      throw error;
    }
  }
  if (method === "DELETE") {
    await deps.links.remove(user);
    return { statusCode: 204, body: "" };
  }
  return json(200, linkStatus(await deps.links.linkForUser(user)));
}

function linkStatus(link: WhatsAppLink | null): Readonly<Record<string, unknown>> {
  if (link === null) return { linked: false };
  return { linked: true, phone: maskPhone(link.phoneE164), linkedAt: new Date(link.linkedAt).toISOString() };
}
