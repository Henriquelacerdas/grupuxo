import { acceptSwapRequest, createSwapRequest, incomingRequests, outgoingRequests, rejectSwapRequest, swapCandidates } from "../../domain/commands/swaps.ts";
import type { CommandContext } from "../../domain/commands/context.ts";
import { addHouseMember, houseMemberIDs, houseMembers, removeHouseMember } from "../../domain/commands/houses.ts";
import { markNotificationAsRead, notificationsFor } from "../../domain/commands/notifications.ts";
import { createRoom, roomFor, roomParticipation, roomsFor } from "../../domain/commands/rooms.ts";
import {
  addRoomMember, claimTask, completeTask, createTask, refreshSchedule, releaseTask, removeRoomMember, reopenTask,
  roomTasks, sporadicTasks, userTasks,
} from "../../domain/commands/tasks.ts";
import { DomainError } from "../../domain/errors.ts";
import type { Instant } from "../../domain/dates.ts";
import type { House, Room, RoomMembership, RoomParticipation, TaskDefinition, TaskItem, TaskSwapRequest, User, AppNotification } from "../../domain/entities.ts";
import type { HouseID, NotificationID, RoomID, TaskOccurrenceID, TaskSwapRequestID, UserID } from "../../domain/ids.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../../domain/repositories.ts";
import type { InMemoryStore } from "./store.ts";

// Os repositórios só chamam os comandos do domínio dentro de uma transação: nenhuma regra mora aqui.

export class InMemoryHouseRepository implements HouseRepository {
  private readonly store: InMemoryStore;
  private readonly ctx: CommandContext;
  constructor(store: InMemoryStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async addMember(name: string, houseID: HouseID, requestedBy: UserID, at: Instant): Promise<User> {
    return this.store.update((s) => addHouseMember(this.ctx, s, name, houseID, requestedBy, at));
  }

  async removeMember(userID: UserID, houseID: HouseID, requestedBy: UserID, at: Instant, confirmRoomDeletion: boolean): Promise<void> {
    this.store.update((s) => removeHouseMember(this.ctx, s, userID, houseID, requestedBy, at, confirmRoomDeletion));
  }

  async house(id: HouseID): Promise<House> {
    return this.store.read((s) => {
      const house = s.houses.find((h) => h.id === id);
      if (house === undefined) throw new DomainError("entityNotFound");
      return house;
    });
  }

  async houses(userID: UserID): Promise<House[]> {
    return this.store.read((s) => {
      const ids = new Set(s.houseMemberships.filter((m) => m.userID === userID).map((m) => m.houseID));
      return s.houses.filter((h) => ids.has(h.id));
    });
  }

  async members(houseID: HouseID): Promise<User[]> {
    return this.store.read((s) => houseMembers(s, houseID));
  }

  async memberIDs(houseID: HouseID): Promise<UserID[]> {
    return this.store.read((s) => houseMemberIDs(s, houseID));
  }
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly store: InMemoryStore;
  private readonly ctx: CommandContext;
  constructor(store: InMemoryStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async participation(roomID: RoomID, requesting: UserID, at: Instant): Promise<RoomParticipation> {
    return this.store.update((s) => roomParticipation(this.ctx, s, roomID, requesting, at));
  }

  async room(id: RoomID, requesting: UserID): Promise<Room> {
    return this.store.read((s) => roomFor(s, id, requesting));
  }

  async rooms(houseID: HouseID, requesting: UserID): Promise<Room[]> {
    return this.store.read((s) => roomsFor(s, houseID, requesting));
  }

  async create(room: Room, memberships: readonly RoomMembership[]): Promise<Room> {
    return this.store.update((s) => createRoom(this.ctx, s, room, memberships, this.ctx.now()));
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly store: InMemoryStore;
  private readonly ctx: CommandContext;
  constructor(store: InMemoryStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async tasks(userID: UserID, houseID: HouseID): Promise<TaskItem[]> {
    const at = this.ctx.now();
    await this.refreshSchedule(houseID, at);
    return this.store.read((s) => userTasks(s, userID, houseID, at));
  }

  async roomTasks(roomID: RoomID, requesting: UserID): Promise<TaskItem[]> {
    return this.store.read((s) => roomTasks(s, roomID, requesting));
  }

  async sporadicTasks(houseID: HouseID, requesting: UserID): Promise<TaskItem[]> {
    const at = this.ctx.now();
    await this.refreshSchedule(houseID, at);
    return this.store.read((s) => sporadicTasks(this.ctx, s, houseID, requesting, at));
  }

  async create(definition: TaskDefinition, requestedBy: UserID, at: Instant): Promise<TaskDefinition> {
    return this.store.update((s) => createTask(this.ctx, s, definition, requestedBy, at));
  }

  async refreshSchedule(houseID: HouseID, at: Instant): Promise<void> {
    this.store.update((s) => refreshSchedule(this.ctx, s, houseID, at));
  }

  async addMember(userID: UserID, roomID: RoomID, at: Instant): Promise<void> {
    this.store.update((s) => addRoomMember(this.ctx, s, userID, roomID, at));
  }

  async removeMember(userID: UserID, roomID: RoomID, at: Instant, confirmDeletion: boolean): Promise<void> {
    this.store.update((s) => removeRoomMember(this.ctx, s, userID, roomID, at, confirmDeletion));
  }

  async complete(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void> {
    this.store.update((s) => completeTask(this.ctx, s, occurrenceID, by, at));
  }

  async reopen(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void> {
    this.store.update((s) => reopenTask(this.ctx, s, occurrenceID, by));
  }

  async claim(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void> {
    this.store.update((s) => claimTask(this.ctx, s, occurrenceID, by, at));
  }

  async release(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void> {
    this.store.update((s) => releaseTask(this.ctx, s, occurrenceID, by));
  }
}

export class InMemoryTaskSwapRepository implements TaskSwapRepository {
  private readonly store: InMemoryStore;
  private readonly ctx: CommandContext;
  constructor(store: InMemoryStore, ctx: CommandContext) {
    this.store = store;
    this.ctx = ctx;
  }

  async swapCandidates(requesterID: UserID, offering: TaskOccurrenceID, houseID: HouseID, at: Instant): Promise<TaskItem[]> {
    return this.store.read((s) => swapCandidates(s, requesterID, offering, houseID, at));
  }

  async createRequest(requesterID: UserID, offered: TaskOccurrenceID, requested: TaskOccurrenceID, at: Instant): Promise<TaskSwapRequest> {
    return this.store.update((s) => createSwapRequest(this.ctx, s, requesterID, offered, requested, at));
  }

  async incomingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.store.read((s) => incomingRequests(s, userID, houseID));
  }

  async outgoingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.store.read((s) => outgoingRequests(s, userID, houseID));
  }

  async accept(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest> {
    return this.store.update((s) => acceptSwapRequest(this.ctx, s, requestID, by, at));
  }

  async reject(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest> {
    return this.store.update((s) => rejectSwapRequest(this.ctx, s, requestID, by, at));
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly store: InMemoryStore;
  constructor(store: InMemoryStore) {
    this.store = store;
  }

  async notifications(userID: UserID): Promise<AppNotification[]> {
    return this.store.read((s) => notificationsFor(s, userID));
  }

  async markAsRead(notificationID: NotificationID, by: UserID, at: Instant): Promise<void> {
    this.store.update((s) => markNotificationAsRead(s, notificationID, by, at));
  }
}
