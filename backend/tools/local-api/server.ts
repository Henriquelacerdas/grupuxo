import { generateKeyPairSync, randomInt, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  InMemoryHouseRepository, InMemoryNotificationRepository, InMemoryRoomRepository, InMemoryTaskRepository, InMemoryTaskSwapRepository,
} from "../../src/adapters/in-memory/repositories.ts";
import { InMemoryPushDirectory } from "../../src/adapters/in-memory/push-directory.ts";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import { InMemoryUserDirectory } from "../../src/adapters/in-memory/user-directory.ts";
import { InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore } from "../../src/adapters/in-memory/whatsapp.ts";
import { CognitoJwtVerifier } from "../../src/auth/cognito-jwt-verifier.ts";
import type { CommandContext } from "../../src/domain/commands/context.ts";
import type { Instant } from "../../src/domain/dates.ts";
import type { IDGenerator, UserID } from "../../src/domain/ids.ts";
import { emptyStoreState } from "../../src/domain/store-state.ts";
import { createApiHandler } from "../../src/lambdas/api.ts";
import { PHOTO_CONTENT_TYPE, photoKeyFor, type PhotoStore, type PhotoUploadTarget } from "../../src/photos/photo-store.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import { CognitoEmulator, LOCAL_CODE } from "./cognito-emulator.ts";

// Servidor local da `api` para desenvolvimento e testes e2e do web. NÃO é implantado e não toca a AWS:
// - `/v1/*`: a mesma `createApiHandler` da Lambda, sobre os adaptadores em memória e o `CognitoJwtVerifier` real
//   (chave RSA gerada na subida, no lugar do JWKS do pool).
// - `/cognito`: emulador da API JSON do Cognito (cadastro, SRP, refresh…), código de confirmação `123456`.
// - `/__photos/<key>`: destino do `PUT` pré-assinado da foto e da leitura.
// - `/__test/*`: relógio do servidor (`clock`), avisos agendados (`scheduled`) e `reset`.
// Escuta só em 127.0.0.1. Uso: `npm run local-api` (porta `PORT`, padrão 4010).

const USER_POOL_ID = "us-east-1_M9GpISkE3";
const CLIENT_ID = "21gqeeehhmeufpipk84e3cc7tu";
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

class LocalPhotoStore implements PhotoStore {
  readonly objects = new Map<string, Buffer>();
  private readonly origin: () => string;
  constructor(origin: () => string) {
    this.origin = origin;
  }

  uploadTarget(userID: UserID, at: Instant): PhotoUploadTarget {
    const key = photoKeyFor(userID);
    return { key, url: `${this.origin()}/__photos/${key}`, headers: { "Content-Type": PHOTO_CONTENT_TYPE }, expiresAt: at + 300_000 };
  }

  viewURL(key: string, at: Instant): string {
    return `${this.origin()}/__photos/${key}?day=${Math.floor(at / 86_400_000)}`;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

interface World {
  readonly handler: (event: unknown) => Promise<{ statusCode: number; headers?: Readonly<Record<string, string>>; body: string }>;
  readonly cognito: CognitoEmulator;
  readonly photos: LocalPhotoStore;
  readonly houses: InMemoryHouseRepository;
  readonly store: InMemoryStore;
}

let clockOffset = 0;
const serverNow = (): Instant => Date.now() + clockOffset;
let origin = "http://127.0.0.1:4010";

function buildWorld(): World {
  const key = { kid: "local-api", ...generateKeyPairSync("rsa", { modulusLength: 2048 }) };
  const tokenTTL = Number(process.env["LOCAL_TOKEN_TTL"] ?? "3600");
  const cognito = new CognitoEmulator({ userPoolID: USER_POOL_ID, clientID: CLIENT_ID, key, tokenTTL, now: () => Date.now() });
  const newID: IDGenerator = () => randomUUID();
  const store = new InMemoryStore(emptyStoreState());
  const ctx: CommandContext = { now: serverNow, newID };
  const newAccessCode = (): string => Array.from({ length: 6 }, () => ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)]).join("");
  const houses = new InMemoryHouseRepository(store, ctx, newAccessCode);
  const tasks = new InMemoryTaskRepository(store, ctx);
  const links = new InMemoryWhatsAppLinkStore();
  const photos = new LocalPhotoStore(() => origin);
  const handler = createApiHandler({
    // Tokens usam o relógio real; o relógio do servidor (domínio) pode ser adiantado pelos testes.
    verifier: new CognitoJwtVerifier({ userPoolID: USER_POOL_ID, clientID: CLIENT_ID }, { jwks: { load: async () => [{ kid: key.kid, publicKey: key.publicKey }] }, now: () => Date.now() }),
    users: new InMemoryUserDirectory(store, newID),
    identities: { deleteIdentity: async (username) => cognito.deleteUser(username) },
    linker: new WhatsAppLinker(createLinkConfig("+15550001234"), new InMemoryLinkTokenStore(), links, serverNow),
    links,
    houses, rooms: new InMemoryRoomRepository(store, ctx), tasks, snapshots: tasks,
    swaps: new InMemoryTaskSwapRepository(store, ctx), notifications: new InMemoryNotificationRepository(store),
    photos, push: new InMemoryPushDirectory(),
    now: serverNow, newID,
  });
  return { handler, cognito, photos, houses, store };
}

let world = buildWorld();

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 5_000_000) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, body: string, headers: Readonly<Record<string, string>> = { "content-type": "application/json" }): void {
  response.writeHead(status, headers);
  response.end(body);
}

function parseJSON(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", origin);
  const method = request.method ?? "GET";
  const body = await readBody(request);

  if (url.pathname.startsWith("/v1/") || url.pathname === "/v1") {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[name.toLowerCase()] = value;
      else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(",");
    }
    const result = await world.handler({
      version: "2.0", rawPath: url.pathname, rawQueryString: url.search.replace(/^\?/, ""), headers,
      requestContext: { http: { method, path: url.pathname } },
      ...(body.length === 0 ? {} : { body: body.toString("utf8"), isBase64Encoded: false }),
    });
    send(response, result.statusCode, result.body, { "content-type": "application/json", ...result.headers });
    return;
  }

  if (url.pathname === "/cognito" && method === "POST") {
    const target = request.headers["x-amz-target"];
    const result = world.cognito.handle(typeof target === "string" ? target : "", parseJSON(body.toString("utf8")));
    send(response, result.status, JSON.stringify(result.body), { "content-type": "application/x-amz-json-1.1" });
    return;
  }

  if (url.pathname.startsWith("/__photos/")) {
    const key = decodeURIComponent(url.pathname.slice("/__photos/".length));
    if (method === "PUT") {
      if (request.headers["content-type"] !== PHOTO_CONTENT_TYPE) return send(response, 403, "{}");
      world.photos.objects.set(key, body);
      return send(response, 200, "");
    }
    const object = world.photos.objects.get(key);
    if (method === "GET" && object !== undefined) return send(response, 200, object.toString("binary"), { "content-type": PHOTO_CONTENT_TYPE });
    return send(response, 404, "");
  }

  if (url.pathname === "/__test/clock" && method === "POST") {
    const input = parseJSON(body.toString("utf8"));
    const advance = typeof input === "object" && input !== null ? Reflect.get(input, "advanceMs") : undefined;
    if (typeof advance === "number" && Number.isFinite(advance)) clockOffset += advance;
    return send(response, 200, JSON.stringify({ now: new Date(serverNow()).toISOString() }));
  }
  if (url.pathname === "/__test/scheduled" && method === "POST") {
    const ids = world.store.read((state) => state.houses.map((house) => house.id));
    let created = 0;
    for (const id of ids) created += await world.houses.emitScheduledNotifications(id, serverNow());
    return send(response, 200, JSON.stringify({ houses: ids.length, created }));
  }
  if (url.pathname === "/__test/reset" && method === "POST") {
    clockOffset = 0;
    world = buildWorld();
    return send(response, 200, "{}");
  }
  if (url.pathname === "/health") return send(response, 200, JSON.stringify({ ok: true, code: LOCAL_CODE }));
  send(response, 404, JSON.stringify({ error: "not_found" }));
}

const server = createServer((request, response) => {
  route(request, response).catch(() => send(response, 500, JSON.stringify({ error: "internal" })));
});

server.listen(Number(process.env["PORT"] ?? "4010"), "127.0.0.1", () => {
  const address: AddressInfo | string | null = server.address();
  if (address !== null && typeof address !== "string") origin = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`local api em ${origin} (Cognito local em ${origin}/cognito, código ${LOCAL_CODE})\n`);
});
