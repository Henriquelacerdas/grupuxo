import { acceptSwapRequest, createSwapRequest, incomingRequests, outgoingRequests, rejectSwapRequest, swapCandidates } from "../../domain/commands/swaps.ts";
import type { CommandContext } from "../../domain/commands/context.ts";
import {
  ACCESS_CODE_ATTEMPTS, addHouseMember, createHouse, houseMemberIDs, houseMembers, joinHouseByCode, leaveHouse,
  normalizeAccessCode, removeHouseMember,
} from "../../domain/commands/houses.ts";
import { markNotificationAsRead, notificationsFor } from "../../domain/commands/notifications.ts";
import { createRoom, roomFor, roomParticipation, roomsFor } from "../../domain/commands/rooms.ts";
import {
  addRoomMember, claimTask, completeTask, createTask, endTask, refreshSchedule, releaseTask, removeRoomMember, reopenTask,
  occurrenceHouseFor, roomTasks, sporadicTasks, taskDefinitionFor, userTasks,
} from "../../domain/commands/tasks.ts";
import { DomainError } from "../../domain/errors.ts";
import { emptyStoreState } from "../../domain/store-state.ts";
import type { Instant } from "../../domain/dates.ts";
import type {
  AppNotification, House, Room, RoomMembership, RoomParticipation, TaskDefinition, TaskItem, TaskSwapRequest, User,
} from "../../domain/entities.ts";
import type { HouseID, NotificationID, RoomID, TaskDefinitionID, TaskOccurrenceID, TaskSwapRequestID, UserID } from "../../domain/ids.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../../domain/repositories.ts";
import { MAX_BATCH_GET_KEYS, queryAll, type DynamoClient, type DynamoKey } from "./client.ts";
import { decodeAccessCode, decodeHouse, decodeNotification, houseOfNotificationItem, houseIDFromGSISK } from "./codec.ts";
import { DynamoStoreError } from "./errors.ts";
import type { HouseStateStore } from "./house-state-store.ts";
import { ACCESS_CODE_SK, GSI1, META_SK, SK_PREFIX, accessCodePK, housePK, userPK } from "./keys.ts";
import { str } from "./reader.ts";

// Espelho de `adapters/in-memory/repositories.ts`: cada método só escolhe a casa e chama o mesmo comando de
// domínio dentro de `HouseStateStore.update`/`read`. Nenhuma regra de negócio mora aqui.

export class DynamoHouseRepository implements HouseRepository {
  private readonly store: HouseStateStore;
  private readonly client: DynamoClient;
  private readonly ctx: CommandContext;
  private readonly newAccessCode: () => string;
  constructor(store: HouseStateStore, client: DynamoClient, ctx: CommandContext, newAccessCode: () => string) {
    this.store = store;
    this.client = client;
    this.ctx = ctx;
    this.newAccessCode = newAccessCode;
  }

  /** Cria a casa pelo caminho condicional do store; se o código já for de outra casa, tenta de novo com outro. */
  async create(founderID: UserID, name: string, timezone: string, at: Instant): Promise<House> {
    for (let attempt = 1; ; attempt += 1) {
      const state = emptyStoreState();
      const house = createHouse(this.ctx, state, founderID, name, timezone, this.newAccessCode, at);
      try {
        await this.store.createHouse(state);
        return house;
      } catch (error) {
        const taken = error instanceof DynamoStoreError && error.code === "accessCodeTaken";
        if (!taken || attempt >= ACCESS_CODE_ATTEMPTS) throw error;
      }
    }
  }

  async joinByCode(userID: UserID, code: string, at: Instant): Promise<House> {
    const normalized = normalizeAccessCode(code);
    if (normalized === null) throw new DomainError("invalidAccessCode");
    const item = await this.client.get({ key: { PK: accessCodePK(normalized), SK: ACCESS_CODE_SK }, consistentRead: true });
    if (item === undefined) throw new DomainError("invalidAccessCode");
    return this.store.update(
      decodeAccessCode(item), (s) => joinHouseByCode(this.ctx, s, userID, normalized, at), { extraProfileIDs: [userID] },
    );
  }

  async leave(userID: UserID, houseID: HouseID, at: Instant, confirmRoomDeletion: boolean): Promise<void> {
    await this.store.update(houseID, (s) => leaveHouse(this.ctx, s, userID, houseID, at, confirmRoomDeletion));
  }

  async addMember(name: string, houseID: HouseID, requestedBy: UserID, at: Instant): Promise<User> {
    return this.store.update(houseID, (s) => addHouseMember(this.ctx, s, name, houseID, requestedBy, at));
  }

  async removeMember(userID: UserID, houseID: HouseID, requestedBy: UserID, at: Instant, confirmRoomDeletion: boolean): Promise<void> {
    await this.store.update(houseID, (s) => removeHouseMember(this.ctx, s, userID, houseID, requestedBy, at, confirmRoomDeletion));
  }

  async house(id: HouseID): Promise<House> {
    const item = await this.client.get({ key: { PK: housePK(id), SK: META_SK }, consistentRead: true });
    if (item === undefined) throw new DomainError("entityNotFound");
    return decodeHouse(item).house;
  }

  async houses(userID: UserID): Promise<House[]> {
    const memberships = await queryAll(this.client, {
      indexName: GSI1, keyCondition: "#pk = :pk AND begins_with(#sk, :prefix)",
      names: { "#pk": "GSI1PK", "#sk": "GSI1SK" }, values: { ":pk": userPK(userID), ":prefix": "HOUSE#" },
      consistentRead: false, scanForward: true,
    });
    const keys: DynamoKey[] = memberships.map((m) => ({ PK: housePK(houseIDFromGSISK(str(m, "GSI1SK"))), SK: META_SK }));
    const houses: House[] = [];
    // Vínculo sem `META` (carga interrompida ou casa apagada) não é uma casa: simplesmente não aparece.
    for (let start = 0; start < keys.length; start += MAX_BATCH_GET_KEYS) {
      for (const item of await this.client.batchGet(keys.slice(start, start + MAX_BATCH_GET_KEYS))) houses.push(decodeHouse(item).house);
    }
    return houses.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async members(houseID: HouseID): Promise<User[]> {
    return this.store.read(houseID, (s) => houseMembers(s, houseID));
  }

  async memberIDs(houseID: HouseID): Promise<UserID[]> {
    return this.store.read(houseID, (s) => houseMemberIDs(s, houseID));
  }
}

export class DynamoRoomRepository implements RoomRepository {
  private readonly store: HouseStateStore;
  private readonly ctx: CommandContext;
  constructor(store: HouseStateStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async participation(roomID: RoomID, requesting: UserID, at: Instant): Promise<RoomParticipation> {
    const houseID = await this.store.houseOf("room", roomID);
    return this.store.update(houseID, (s) => roomParticipation(this.ctx, s, roomID, requesting, at));
  }

  async room(id: RoomID, requesting: UserID): Promise<Room> {
    const houseID = await this.store.houseOf("room", id);
    return this.store.read(houseID, (s) => roomFor(s, id, requesting));
  }

  async rooms(houseID: HouseID, requesting: UserID): Promise<Room[]> {
    return this.store.read(houseID, (s) => roomsFor(s, houseID, requesting));
  }

  async create(room: Room, memberships: readonly RoomMembership[]): Promise<Room> {
    return this.store.update(room.houseID, (s) => createRoom(this.ctx, s, room, memberships, this.ctx.now()));
  }
}

export class DynamoTaskRepository implements TaskRepository {
  private readonly store: HouseStateStore;
  private readonly ctx: CommandContext;
  constructor(store: HouseStateStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async tasks(userID: UserID, houseID: HouseID): Promise<TaskItem[]> {
    const at = this.ctx.now();
    return this.store.update(houseID, (s) => {
      refreshSchedule(this.ctx, s, houseID, at);
      return userTasks(s, userID, houseID, at);
    });
  }

  async roomTasks(roomID: RoomID, requesting: UserID): Promise<TaskItem[]> {
    const houseID = await this.store.houseOf("room", roomID);
    return this.store.read(houseID, (s) => roomTasks(s, roomID, requesting));
  }

  async definition(roomID: RoomID, taskID: TaskDefinitionID, requesting: UserID): Promise<TaskDefinition> {
    const houseID = await this.store.houseOf("room", roomID);
    return this.store.read(houseID, (s) => taskDefinitionFor(s, roomID, taskID, requesting));
  }

  async houseOfOccurrence(occurrenceID: TaskOccurrenceID, requesting: UserID): Promise<HouseID> {
    const houseID = await this.store.houseOf("occurrence", occurrenceID);
    return this.store.read(houseID, (s) => occurrenceHouseFor(s, occurrenceID, requesting));
  }

  async sporadicTasks(houseID: HouseID, requesting: UserID): Promise<TaskItem[]> {
    const at = this.ctx.now();
    return this.store.update(houseID, (s) => {
      refreshSchedule(this.ctx, s, houseID, at);
      return sporadicTasks(this.ctx, s, houseID, requesting, at);
    });
  }

  async create(definition: TaskDefinition, requestedBy: UserID, at: Instant): Promise<TaskDefinition> {
    const houseID = await this.store.houseOf("room", definition.roomID);
    return this.store.update(houseID, (s) => createTask(this.ctx, s, definition, requestedBy, at));
  }

  async endTask(roomID: RoomID, taskID: TaskDefinitionID, requestedBy: UserID, at: Instant): Promise<void> {
    const houseID = await this.store.houseOf("room", roomID);
    await this.store.update(houseID, (s) => endTask(this.ctx, s, roomID, taskID, requestedBy, at));
  }

  async refreshSchedule(houseID: HouseID, at: Instant): Promise<void> {
    await this.store.update(houseID, (s) => refreshSchedule(this.ctx, s, houseID, at));
  }

  async addMember(userID: UserID, roomID: RoomID, at: Instant): Promise<void> {
    const houseID = await this.store.houseOf("room", roomID);
    await this.store.update(houseID, (s) => addRoomMember(this.ctx, s, userID, roomID, at));
  }

  async removeMember(userID: UserID, roomID: RoomID, at: Instant, confirmDeletion: boolean): Promise<void> {
    const houseID = await this.store.houseOf("room", roomID);
    await this.store.update(houseID, (s) => removeRoomMember(this.ctx, s, userID, roomID, at, confirmDeletion));
  }

  async complete(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void> {
    const houseID = await this.store.houseOf("occurrence", occurrenceID);
    await this.store.update(houseID, (s) => completeTask(this.ctx, s, occurrenceID, by, at));
  }

  async reopen(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void> {
    const houseID = await this.store.houseOf("occurrence", occurrenceID);
    await this.store.update(houseID, (s) => reopenTask(this.ctx, s, occurrenceID, by));
  }

  async claim(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void> {
    const houseID = await this.store.houseOf("occurrence", occurrenceID);
    await this.store.update(houseID, (s) => claimTask(this.ctx, s, occurrenceID, by, at));
  }

  async release(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void> {
    const houseID = await this.store.houseOf("occurrence", occurrenceID);
    await this.store.update(houseID, (s) => releaseTask(this.ctx, s, occurrenceID, by));
  }
}

export class DynamoTaskSwapRepository implements TaskSwapRepository {
  private readonly store: HouseStateStore;
  private readonly ctx: CommandContext;
  constructor(store: HouseStateStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async swapCandidates(requesterID: UserID, offering: TaskOccurrenceID, houseID: HouseID, at: Instant): Promise<TaskItem[]> {
    return this.store.read(houseID, (s) => swapCandidates(s, requesterID, offering, houseID, at));
  }

  async createRequest(requesterID: UserID, offered: TaskOccurrenceID, requested: TaskOccurrenceID, at: Instant): Promise<TaskSwapRequest> {
    const houseID = await this.store.houseOf("occurrence", offered);
    return this.store.update(houseID, (s) => createSwapRequest(this.ctx, s, requesterID, offered, requested, at));
  }

  async incomingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.store.read(houseID, (s) => incomingRequests(s, userID, houseID));
  }

  async outgoingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.store.read(houseID, (s) => outgoingRequests(s, userID, houseID));
  }

  async accept(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest> {
    const houseID = await this.store.houseOf("swap", requestID);
    return this.store.update(houseID, (s) => acceptSwapRequest(this.ctx, s, requestID, by, at));
  }

  async reject(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest> {
    const houseID = await this.store.houseOf("swap", requestID);
    return this.store.update(houseID, (s) => rejectSwapRequest(this.ctx, s, requestID, by, at));
  }
}

export class DynamoNotificationRepository implements NotificationRepository {
  private readonly store: HouseStateStore;
  private readonly client: DynamoClient;
  constructor(store: HouseStateStore, client: DynamoClient) {
    this.store = store;
    this.client = client;
  }

  /** Notificações do morador em todas as casas, mais recentes primeiro (`GSI1`, eventualmente consistente). */
  private async items(userID: UserID): Promise<{ readonly houseID: HouseID; readonly notification: AppNotification }[]> {
    const items = await queryAll(this.client, {
      indexName: GSI1, keyCondition: "#pk = :pk AND begins_with(#sk, :prefix)",
      names: { "#pk": "GSI1PK", "#sk": "GSI1SK" }, values: { ":pk": userPK(userID), ":prefix": SK_PREFIX.notification },
      consistentRead: false, scanForward: false,
    });
    return items.map((item) => ({ houseID: houseOfNotificationItem(item), notification: decodeNotification(item) }));
  }

  async notifications(userID: UserID): Promise<AppNotification[]> {
    const found = (await this.items(userID)).map((entry) => entry.notification);
    // Mesma ordenação do domínio (`notificationsFor`), sobre um estado só com as notificações lidas.
    return notificationsFor(
      {
        users: [], houses: [], houseMemberships: [], rooms: [], roomMemberships: [], definitions: [], occurrences: [],
        assignments: [], absences: [], taskSwapRequests: [], notifications: found,
      },
      userID,
    );
  }

  async markAsRead(notificationID: NotificationID, by: UserID, at: Instant): Promise<void> {
    const entry = (await this.items(by)).find((candidate) => candidate.notification.id === notificationID);
    if (entry === undefined) throw new DomainError("entityNotFound");
    await this.store.update(entry.houseID, (s) => markNotificationAsRead(s, notificationID, by, at));
  }
}
