import { AuthenticationError, TokenVerifierUnavailableError, type TokenVerifier } from "../auth/token-verifier.ts";
import { parseProfileName, UserDirectoryError, type UserDirectory } from "../auth/user-directory.ts";
import type { Instant } from "../domain/dates.ts";
import type { IDGenerator, UserID } from "../domain/ids.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../domain/repositories.ts";
import type { WhatsAppLinker } from "../whatsapp/linking/whatsapp-linker.ts";
import { WhatsAppLinkError, type WhatsAppLink, type WhatsAppLinkStore } from "../whatsapp/ports.ts";
import { failure, json, jsonObject, storageOrDomainFailure } from "./api-http.ts";
import { createRouteHandlers } from "./api-routes.ts";
import { matchRoute, type AccountRouteName, type RouteName } from "./api-router.ts";
import { field, parseHttpApiEvent, type HttpApiRequest, type HttpApiResult } from "./events.ts";

export interface ApiDependencies {
  readonly verifier: TokenVerifier;
  readonly users: UserDirectory;
  readonly linker: Pick<WhatsAppLinker, "issueInvitation">;
  readonly links: Pick<WhatsAppLinkStore, "linkForUser" | "remove">;
  readonly houses: HouseRepository;
  readonly rooms: RoomRepository;
  readonly tasks: TaskRepository;
  readonly swaps: TaskSwapRepository;
  readonly notifications: NotificationRepository;
  /** Relógio do servidor: o `at` de todo comando, nunca o do cliente. */
  readonly now: () => Instant;
  readonly newID: IDGenerator;
}

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

/**
 * Lambda `api` (Function URL pública, payload 2.0; autorização feita aqui, a URL fica sem autenticação da AWS). O `userID` vem sempre do
 * access token do Cognito (via `UserDirectory`), nunca do corpo ou da URL. Rota e método são verificados antes do
 * token (404/405). 401 não revela o motivo; 503 quando as chaves do Cognito estão indisponíveis; erro de domínio ou
 * de armazenamento conhecido vira a resposta da seção 6.1 do BACKEND.md; o resto é 500 sem detalhe. Não registra nada em log.
 */
export function createApiHandler(deps: ApiDependencies): (event: unknown) => Promise<HttpApiResult> {
  const appRoutes = createRouteHandlers(deps);
  return async (event) => {
    const request = parseHttpApiEvent(event);
    if (request === null) return failure(400, "bad_request");
    const match = matchRoute(request.method, request.path);
    if (match.kind === "notFound") return failure(404, "not_found");
    if (match.kind === "methodNotAllowed") return failure(405, "method_not_allowed", { allow: match.allow.join(", ") });

    try {
      const token = bearerToken(request);
      if (token === null) return failure(401, "unauthorized");
      const { cognitoSub } = await deps.verifier.verify(token);
      if (match.name === "registerAccount") return await registerAccount(deps, cognitoSub, request);

      // As demais rotas exigem que a conta já tenha passado pelo `POST /v1/me`.
      const user = await deps.users.userForSub(cognitoSub);
      if (user === null) return failure(403, "account_not_registered");
      if (match.name === "myAccount") return json(200, { id: user });
      if (isAccountRoute(match.name)) return await whatsAppRoute(deps, match.name, user);
      return await appRoutes(match.name, { user, params: match.params, query: request.queryParameters, body: request.body });
    } catch (error) {
      if (error instanceof AuthenticationError) return failure(401, "unauthorized");
      if (error instanceof TokenVerifierUnavailableError) return failure(503, "unavailable");
      return storageOrDomainFailure(error) ?? failure(500, "internal");
    }
  };
}

type WhatsAppRouteName = Exclude<AccountRouteName, "registerAccount" | "myAccount">;

function isAccountRoute(name: RouteName): name is WhatsAppRouteName {
  return name === "issueWhatsAppLink" || name === "whatsAppStatus" || name === "unlinkWhatsApp";
}

async function registerAccount(
  deps: ApiDependencies, cognitoSub: Parameters<UserDirectory["userForSub"]>[0], request: HttpApiRequest,
): Promise<HttpApiResult> {
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

async function whatsAppRoute(deps: ApiDependencies, name: WhatsAppRouteName, user: UserID): Promise<HttpApiResult> {
  switch (name) {
    case "issueWhatsAppLink":
      try {
        const invitation = await deps.linker.issueInvitation(user);
        return json(200, { url: invitation.url, expiresAt: new Date(invitation.expiresAt).toISOString() });
      } catch (error) {
        if (error instanceof WhatsAppLinkError && error.code === "userAlreadyLinked") return failure(409, "already_linked");
        throw error;
      }
    case "unlinkWhatsApp":
      await deps.links.remove(user);
      return { statusCode: 204, body: "" };
    case "whatsAppStatus":
      return json(200, linkStatus(await deps.links.linkForUser(user)));
  }
}

function linkStatus(link: WhatsAppLink | null): Readonly<Record<string, unknown>> {
  if (link === null) return { linked: false };
  return { linked: true, phone: maskPhone(link.phoneE164), linkedAt: new Date(link.linkedAt).toISOString() };
}
