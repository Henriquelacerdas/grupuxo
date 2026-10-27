import { DynamoNotificationRepository, DynamoHouseRepository, DynamoRoomRepository, DynamoTaskRepository, DynamoTaskSwapRepository } from "../../src/adapters/dynamodb/repositories.ts";
import { HouseStateStore, type DynamoRuntime } from "../../src/adapters/dynamodb/house-state-store.ts";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import {
  InMemoryHouseRepository, InMemoryNotificationRepository, InMemoryRoomRepository, InMemoryTaskRepository, InMemoryTaskSwapRepository,
} from "../../src/adapters/in-memory/repositories.ts";
import type { RepositoryEnv } from "../contract/repositories.ts";
import { encodeUser } from "../../src/adapters/dynamodb/codec.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { sequentialAccessCodes } from "../support/state-json.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import type { World } from "../support/world.ts";

/** Sem espera real e sem aleatoriedade: os testes não dependem de tempo. */
export const instantRuntime: DynamoRuntime = { sleep: async () => {}, random: () => 0 };

export interface DynamoEnvironment extends RepositoryEnv {
  readonly tasks: DynamoTaskRepository;
  readonly client: FakeDynamoClient;
  readonly store: HouseStateStore;
}

/** Adaptador DynamoDB sobre o cliente falso, com a casa de demonstração do mundo já semeada. */
export async function dynamoEnvironment(
  world: World, state: StoreState = world.seed.state, client = new FakeDynamoClient({ pageSize: 7 }),
  accessCodes: () => string = sequentialAccessCodes(),
): Promise<DynamoEnvironment> {
  const store = new HouseStateStore(client, instantRuntime);
  await store.seedHouse(state);
  const houseID = world.seed.house.id;
  const ctx = world.ctx;
  return {
    world, client, store,
    houses: new DynamoHouseRepository(store, client, ctx, accessCodes),
    rooms: new DynamoRoomRepository(store, ctx),
    tasks: new DynamoTaskRepository(store, ctx),
    swaps: new DynamoTaskSwapRepository(store, ctx),
    notifications: new DynamoNotificationRepository(store, client),
    state: () => store.read(houseID, (s) => s),
    update: async (fn) => store.update(houseID, (s) => { fn(s); }),
    registerUser: async (user) => { await client.put({ item: encodeUser(user) }); },
  };
}

export function inMemoryEnvironment(
  world: World, state: StoreState = world.seed.state, accessCodes: () => string = sequentialAccessCodes(),
): RepositoryEnv {
  const store = new InMemoryStore(state);
  const ctx = world.ctx;
  return {
    world,
    houses: new InMemoryHouseRepository(store, ctx, accessCodes), rooms: new InMemoryRoomRepository(store, ctx),
    tasks: new InMemoryTaskRepository(store, ctx), swaps: new InMemoryTaskSwapRepository(store, ctx),
    notifications: new InMemoryNotificationRepository(store),
    state: async () => store.read((s) => s),
    update: async (fn) => { store.update((s) => { fn(s); }); },
    registerUser: async (user) => { store.update((s) => { s.users.push(user); }); },
  };
}
