import { DynamoUserDirectory } from "../../src/adapters/dynamodb/user-directory.ts";
import {
  DynamoHouseRepository, DynamoNotificationRepository, DynamoRoomRepository, DynamoTaskRepository, DynamoTaskSwapRepository,
} from "../../src/adapters/dynamodb/repositories.ts";
import { HouseStateStore } from "../../src/adapters/dynamodb/house-state-store.ts";
import {
  InMemoryHouseRepository, InMemoryNotificationRepository, InMemoryRoomRepository, InMemoryTaskRepository,
  InMemoryTaskSwapRepository,
} from "../../src/adapters/in-memory/repositories.ts";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import { InMemoryUserDirectory } from "../../src/adapters/in-memory/user-directory.ts";
import { InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore } from "../../src/adapters/in-memory/whatsapp.ts";
import { CognitoJwtVerifier } from "../../src/auth/cognito-jwt-verifier.ts";
import type { UserDirectory } from "../../src/auth/user-directory.ts";
import type { CommandContext } from "../../src/domain/commands/context.ts";
import type { Instant } from "../../src/domain/dates.ts";
import { emptyStoreState } from "../../src/domain/store-state.ts";
import { createApiHandler, type ApiDependencies } from "../../src/lambdas/api.ts";
import type { HttpApiResult } from "../../src/lambdas/events.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import {
  CLIENT_ID, FakeJwksSource, NOW, USER_POOL_ID, accessClaims, generateKey, signJWT,
} from "../auth/support.ts";
import { instantRuntime } from "../dynamodb/environment.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { sequentialAccessCodes, sequentialIDs } from "../support/state-json.ts";
import { httpEvent } from "./support.ts";

/** Relógio do servidor dos testes das rotas (diferente do relógio dos tokens, que é `NOW` de `auth/support`). */
export const ROUTES_NOW: Instant = Date.UTC(2026, 9, 14, 12);

/** Repositórios em memória sobre um store (para os testes que só precisam do handler montado). */
export function inMemoryApiDeps(
  store: InMemoryStore, newID = sequentialIDs(), now: () => Instant = () => ROUTES_NOW,
): Pick<ApiDependencies, "houses" | "rooms" | "tasks" | "swaps" | "notifications" | "now" | "newID"> {
  const ctx: CommandContext = { now, newID };
  return {
    houses: new InMemoryHouseRepository(store, ctx, sequentialAccessCodes()),
    rooms: new InMemoryRoomRepository(store, ctx),
    tasks: new InMemoryTaskRepository(store, ctx),
    swaps: new InMemoryTaskSwapRepository(store, ctx),
    notifications: new InMemoryNotificationRepository(store),
    now,
    newID,
  };
}

export type Who = "ana" | "bia" | "caio";

const SUBS: Readonly<Record<Who, string>> = {
  ana: "11111111-aaaa-4aaa-8aaa-000000000001",
  bia: "22222222-bbbb-4bbb-8bbb-000000000002",
  caio: "33333333-cccc-4ccc-8ccc-000000000003",
};

export interface CallOptions {
  readonly body?: string;
  readonly query?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiEnv {
  readonly users: UserDirectory;
  /** Relógio do servidor (mutável). */
  clock: Instant;
  call(who: Who | null, method: string, path: string, options?: CallOptions): Promise<HttpApiResult>;
  /** Estado persistido, para conferir que uma rota não gravou nada. */
  snapshot(): unknown;
}

export type ApiEnvFactory = () => ApiEnv;

const key = generateKey("kid-routes");

/** Relógio único do ambiente: o handler e os repositórios leem o mesmo, e o teste o avança. */
interface Clock { value: Instant }

function assemble(
  base: Pick<ApiDependencies, "users" | "houses" | "rooms" | "tasks" | "swaps" | "notifications" | "newID">, clock: Clock, snapshot: () => unknown,
): ApiEnv {
  const links = new InMemoryWhatsAppLinkStore();
  const handler = createApiHandler({
    ...base,
    verifier: new CognitoJwtVerifier({ userPoolID: USER_POOL_ID, clientID: CLIENT_ID }, { jwks: new FakeJwksSource([key]), now: () => NOW }),
    linker: new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => NOW),
    links,
    now: () => clock.value,
  });
  return {
    users: base.users,
    get clock() { return clock.value; },
    set clock(value: Instant) { clock.value = value; },
    snapshot,
    call: (who, method, path, options = {}) => handler(httpEvent({
      method, path,
      headers: {
        ...(who === null ? {} : { authorization: `Bearer ${signJWT({ key, claims: accessClaims({ sub: SUBS[who], username: SUBS[who] }) })}` }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.query === undefined ? {} : { rawQueryString: options.query }),
    })),
  };
}

export function inMemoryApiEnv(): ApiEnv {
  const newID = sequentialIDs();
  const store = new InMemoryStore(emptyStoreState());
  const clock: Clock = { value: ROUTES_NOW };
  const deps = inMemoryApiDeps(store, newID, () => clock.value);
  return assemble({ ...deps, users: new InMemoryUserDirectory(store, newID) }, clock, () => store.read((s) => s));
}

/** DynamoDB sobre o cliente falso, com a escrita dividida ligada como será no ponto de entrada do TestFlight. */
export function dynamoApiEnv(): ApiEnv {
  const newID = sequentialIDs();
  const client = new FakeDynamoClient({ pageSize: 7 });
  const store = new HouseStateStore(client, instantRuntime, { oversizedWrites: "split" });
  const clock: Clock = { value: ROUTES_NOW };
  const ctx: CommandContext = { now: () => clock.value, newID };
  return assemble({
    users: new DynamoUserDirectory({ client, newID, now: () => clock.value }),
    houses: new DynamoHouseRepository(store, client, ctx, sequentialAccessCodes()),
    rooms: new DynamoRoomRepository(store, ctx),
    tasks: new DynamoTaskRepository(store, ctx),
    swaps: new DynamoTaskSwapRepository(store, ctx),
    notifications: new DynamoNotificationRepository(store, client),
    newID,
  }, clock, () => client.snapshot());
}
