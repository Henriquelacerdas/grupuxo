import type { HouseSnapshotRepository } from "../domain/commands/house-snapshot.ts";
import type { IdentityRemover } from "../auth/identity-remover.ts";
import { AuthenticationError, TokenVerifierUnavailableError, type TokenVerifier, type VerifiedToken } from "../auth/token-verifier.ts";
import { parseProfileName, UserDirectoryError, type UserDirectory } from "../auth/user-directory.ts";
import type { Instant } from "../domain/dates.ts";
import { photoKeyFor, type PhotoStore } from "../photos/photo-store.ts";
import { validDeviceToken, validPreferences, type NotificationPreferences, type PushDirectory } from "../push/push.ts";
import { isDomainError } from "../domain/errors.ts";
import type { IDGenerator, UserID } from "../domain/ids.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../domain/repositories.ts";
import type { WhatsAppLinker } from "../whatsapp/linking/whatsapp-linker.ts";
import { WhatsAppLinkError, type WhatsAppLink, type WhatsAppLinkStore } from "../whatsapp/ports.ts";
import { failure, json, jsonObject, storageOrDomainFailure } from "./api-http.ts";
import { parseRename } from "./api-input.ts";
import { createRouteHandlers } from "./api-routes.ts";
import { matchRoute, type AccountRouteName, type RouteName } from "./api-router.ts";
import { field, parseHttpApiEvent, type HttpApiRequest, type HttpApiResult } from "./events.ts";

export interface ApiDependencies {
  readonly verifier: TokenVerifier;
  readonly users: UserDirectory;
  /** Apaga o usuário do Cognito ao excluir a conta (`DELETE /v1/me`). */
  readonly identities: IdentityRemover;
  readonly linker: Pick<WhatsAppLinker, "issueInvitation">;
  readonly links: Pick<WhatsAppLinkStore, "linkForUser" | "remove">;
  readonly snapshots: HouseSnapshotRepository;
  readonly houses: HouseRepository;
  readonly rooms: RoomRepository;
  readonly tasks: TaskRepository;
  readonly swaps: TaskSwapRepository;
  readonly notifications: NotificationRepository;
  /** Fotos de perfil (S3 + URLs pré-assinadas); ausente = o servidor não tem armazenamento de fotos. */
  readonly photos?: PhotoStore;
  /** Aparelhos e preferências de push; ausente = o servidor não tem push (as rotas respondem `503 push_unavailable`). */
  readonly push?: PushDirectory;
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
  const { photos } = deps;
  const appRoutes = createRouteHandlers(photos === undefined ? deps : {
    ...deps, photoURL: (user) => (user.photoKey === undefined ? null : photos.viewURL(user.photoKey, deps.now())),
  });
  return async (event) => {
    const request = parseHttpApiEvent(event);
    if (request === null) return failure(400, "bad_request");
    const match = matchRoute(request.method, request.path);
    if (match.kind === "notFound") return failure(404, "not_found");
    if (match.kind === "methodNotAllowed") return failure(405, "method_not_allowed", { allow: match.allow.join(", ") });

    try {
      const token = bearerToken(request);
      if (token === null) return failure(401, "unauthorized");
      const verified = await deps.verifier.verify(token);
      const { cognitoSub } = verified;
      if (match.name === "registerAccount") return await registerAccount(deps, cognitoSub, request);

      const user = await deps.users.userForSub(cognitoSub);
      // Excluir a conta vale também para quem nunca passou pelo `POST /v1/me`: o usuário do Cognito existe mesmo assim.
      if (match.name === "deleteAccount") return await deleteAccount(deps, verified, user);
      // As demais rotas exigem que a conta já tenha passado pelo `POST /v1/me`.
      if (user === null) return failure(403, "account_not_registered");
      if (match.name === "myAccount") return json(200, { id: user });
      if (match.name === "updateAccount") return await updateAccount(deps, user, request);
      if (match.name === "registerDevice" || match.name === "removeDevice" || match.name === "getPreferences" || match.name === "setPreferences") {
        return await pushRoute(deps, match.name, user, request);
      }
      if (match.name === "requestPhotoUpload" || match.name === "confirmPhoto" || match.name === "deletePhoto") {
        return await photoRoute(deps, match.name, user, request);
      }
      if (isAccountRoute(match.name)) return await whatsAppRoute(deps, match.name, user);
      return await appRoutes(match.name, { user, params: match.params, query: request.queryParameters, body: request.body });
    } catch (error) {
      if (error instanceof AuthenticationError) return failure(401, "unauthorized");
      if (error instanceof TokenVerifierUnavailableError) return failure(503, "unavailable");
      return storageOrDomainFailure(error) ?? failure(500, "internal");
    }
  };
}

type WhatsAppRouteName = Exclude<
  AccountRouteName, "registerAccount" | "myAccount" | "updateAccount" | "deleteAccount" | "requestPhotoUpload" | "confirmPhoto" | "deletePhoto"
  | "registerDevice" | "removeDevice" | "getPreferences" | "setPreferences"
>;

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

/** `PATCH /v1/me`: muda o nome do morador (1 a 80 caracteres, sem controle). Nome inválido: `400 invalid_name`. */
async function updateAccount(deps: ApiDependencies, user: UserID, request: HttpApiRequest): Promise<HttpApiResult> {
  const body = jsonObject(request.body);
  const input = body === null ? null : parseRename(body);
  const name = input === null ? null : parseProfileName(input.name);
  if (name === null) return failure(400, "invalid_name");
  try {
    await deps.users.updateName(user, name);
  } catch (error) {
    if (error instanceof UserDirectoryError) return failure(400, "invalid_name");
    throw error;
  }
  return json(200, { id: user, name });
}

const preferenceFlags = ["remindTasks", "cycleTurned", "houseActivity", "weeklySummary"] as const;

/** Corpo de `PUT /me/notification-preferences`: os quatro interruptores e `reminderHour` (0 a 23); outra coisa → `null`. */
function parsePreferences(body: ReturnType<typeof jsonObject>): NotificationPreferences | null {
  if (body === null) return null;
  const flags = preferenceFlags.map((name) => field(body, name));
  const hour = field(body, "reminderHour");
  if (!flags.every((flag) => typeof flag === "boolean") || typeof hour !== "number") return null;
  const [remindTasks, cycleTurned, houseActivity, weeklySummary] = flags;
  if (remindTasks === undefined || cycleTurned === undefined || houseActivity === undefined || weeklySummary === undefined) return null;
  if (typeof remindTasks !== "boolean" || typeof cycleTurned !== "boolean" || typeof houseActivity !== "boolean" || typeof weeklySummary !== "boolean") return null;
  const preferences = { remindTasks, reminderHour: hour, cycleTurned, houseActivity, weeklySummary };
  return validPreferences(preferences) ? preferences : null;
}

/**
 * Push: `PUT /me/devices { token, environment }` registra o aparelho (idempotente), `DELETE /me/devices?token=` tira, e
 * `GET`/`PUT /me/notification-preferences` leem e gravam as preferências. Sem push configurado: `503 push_unavailable`.
 */
async function pushRoute(
  deps: ApiDependencies, name: "registerDevice" | "removeDevice" | "getPreferences" | "setPreferences", user: UserID,
  request: HttpApiRequest,
): Promise<HttpApiResult> {
  const { push } = deps;
  if (push === undefined) return failure(503, "push_unavailable");
  switch (name) {
    case "registerDevice": {
      const body = jsonObject(request.body);
      const token = body === null ? undefined : field(body, "token");
      const environment = body === null ? undefined : field(body, "environment");
      if (typeof token !== "string" || !validDeviceToken(token) || (environment !== "sandbox" && environment !== "production")) {
        return failure(400, "bad_request");
      }
      await push.registerDevice(user, { token, environment }, deps.now());
      return { statusCode: 204, body: "" };
    }
    case "removeDevice": {
      const token = request.queryParameters["token"];
      if (token === undefined || !validDeviceToken(token)) return failure(400, "bad_request");
      await push.removeDevice(user, token);
      return { statusCode: 204, body: "" };
    }
    case "getPreferences":
      return json(200, await push.preferences(user));
    case "setPreferences": {
      const preferences = parsePreferences(jsonObject(request.body));
      if (preferences === null) return failure(400, "bad_request");
      await push.setPreferences(user, preferences);
      return json(200, preferences);
    }
  }
}

/**
 * Foto do perfil: `POST /me/photo` devolve o URL de envio (PUT pré-assinado, JPEG, 5 min); o app envia direto ao S3 e
 * confirma com `PUT /me/photo { key }` (a chave tem de ser a do próprio morador, `photos/<userID>`); `DELETE` apaga. Sem
 * armazenamento configurado: `503 photos_unavailable`.
 */
async function photoRoute(
  deps: ApiDependencies, name: "requestPhotoUpload" | "confirmPhoto" | "deletePhoto", user: UserID, request: HttpApiRequest,
): Promise<HttpApiResult> {
  const { photos } = deps;
  if (photos === undefined) return failure(503, "photos_unavailable");
  switch (name) {
    case "requestPhotoUpload": {
      const target = photos.uploadTarget(user, deps.now());
      return json(200, { key: target.key, uploadURL: target.url, headers: target.headers, expiresAt: new Date(target.expiresAt).toISOString() });
    }
    case "confirmPhoto": {
      const body = jsonObject(request.body);
      const key = body === null ? undefined : field(body, "key");
      if (typeof key !== "string" || key !== photoKeyFor(user)) return failure(400, "bad_request");
      await deps.users.updatePhoto(user, key);
      return json(200, { photoURL: photos.viewURL(key, deps.now()) });
    }
    case "deletePhoto":
      await deps.users.updatePhoto(user, null);
      await photos.remove(photoKeyFor(user));
      return { statusCode: 204, body: "" };
  }
}

/**
 * `DELETE /v1/me`: tira o morador da casa (o último morador leva a casa junto), desvincula o WhatsApp, apaga a conta
 * do diretório e, por último, o usuário do Cognito (com o `username` do próprio token). A confirmação é do app.
 * `user` é `null` para quem nunca registrou a conta: sobra só o usuário do Cognito. Cada passo é idempotente e o do
 * Cognito é o último, então repetir depois de uma falha termina o serviço, mesmo com a conta do diretório já apagada.
 */
async function deleteAccount(deps: ApiDependencies, token: VerifiedToken, user: UserID | null): Promise<HttpApiResult> {
  if (user !== null) {
    for (const house of await deps.houses.houses(user)) {
      try {
        await deps.houses.leave(user, house.id, deps.now(), true, true);
      } catch (error) {
        // O índice ainda mostrava uma casa de que o morador já saiu (tentativa anterior): nada a fazer.
        if (!isDomainError(error, "entityNotFound")) throw error;
      }
    }
    await deps.links.remove(user);
    // A foto vai junto com a conta; apagar é idempotente, e a falha não impede o resto (o objeto é só um arquivo).
    await deps.photos?.remove(photoKeyFor(user)).catch(() => undefined);
    await deps.users.deleteUser(token.cognitoSub);
  }
  await deps.identities.deleteIdentity(token.username ?? token.cognitoSub);
  return { statusCode: 204, body: "" };
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
