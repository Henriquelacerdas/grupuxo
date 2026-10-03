import { at, lastWhere } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import {
  isCurrentMember, representsWholeHouse, type Room, type RoomMembership, type RoomParticipation,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, RoomID, UserID } from "../ids.ts";
import { isValidPeriodicity } from "../value-objects.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";

/** Versões da escala contêm IDs de tarefas: não atravessam a fronteira de acesso do cômodo. */
function visibleRoom(room: Room, userID: UserID, state: StoreState): Room {
  const isMember = state.roomMemberships.some((m) => m.roomID === room.id && m.userID === userID && isCurrentMember(m));
  return isMember ? room : { ...room, scheduleVersions: [] };
}

function requireHouseMember(state: StoreState, houseID: HouseID, userID: UserID): void {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) {
    throw new DomainError("entityNotFound");
  }
}

export function roomFor(state: StoreState, id: RoomID, userID: UserID): Room {
  const room = state.rooms.find((r) => r.id === id);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, userID);
  return visibleRoom(room, userID, state);
}

export function roomsFor(state: StoreState, houseID: HouseID, userID: UserID): Room[] {
  requireHouseMember(state, houseID, userID);
  return state.rooms.filter((r) => r.houseID === houseID).map((r) => visibleRoom(r, userID, state));
}

/** Inicializa a escala dos cômodos da casa se preciso (muta o estado) e descreve o período atual. */
export function roomParticipation(
  ctx: CommandContext, state: StoreState, roomID: RoomID, userID: UserID, date: Instant,
): RoomParticipation {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, userID);
  const scheduling = schedulingFor(ctx, state, room.houseID);
  scheduling.initializeRooms(room.houseID, date, state);
  const updated = state.rooms.find((r) => r.id === roomID);
  if (updated === undefined || updated.calendarAnchor === null) throw new DomainError("entityNotFound");
  const members = state.roomMemberships.filter((m) => m.roomID === roomID && isCurrentMember(m));
  const isMember = members.some((m) => m.userID === userID);
  const period = scheduling.periodIndex(updated, date);
  const start = scheduling.addingWeeks(period * updated.periodicity.intervalWeeks, updated.calendarAnchor);
  const end = scheduling.addingWeeks(updated.periodicity.intervalWeeks, start);
  const names: string[] = [];
  const version = lastWhere(updated.scheduleVersions, (v) => v.effectiveAt <= date);
  if (isMember && version !== undefined && version.queue.length > 0) {
    for (let role = 0; role < version.responsibleCount; role++) {
      const slot = (period - version.periodIndex) * version.responsibleCount + role;
      const user = at(version.queue, slot % version.queue.length);
      const name = state.users.find((u) => u.id === user)?.name;
      if (name !== undefined) names.push(name);
    }
  }
  return {
    room: visibleRoom(updated, userID, state), isMember, memberCount: isMember ? members.length : 0,
    responsibleNames: names, periodStart: start, periodEnd: end,
  };
}

export function createRoom(
  ctx: CommandContext, state: StoreState, room: Room, memberships: readonly RoomMembership[], now: Instant,
): Room {
  const users = new Set(state.houseMemberships.filter((m) => m.houseID === room.houseID).map((m) => m.userID));
  const participants = new Set(memberships.map((m) => m.userID));
  const sameParticipants = participants.size === users.size && [...participants].every((u) => users.has(u));
  const valid = state.houses.some((h) => h.id === room.houseID) && participants.size > 0 &&
    participants.size === memberships.length && [...participants].every((u) => users.has(u)) &&
    memberships.every((m) => m.roomID === room.id && isCurrentMember(m)) &&
    (room.visibility !== "common" || sameParticipants) &&
    (!representsWholeHouse(room) || room.visibility === "common");
  if (!valid) throw new DomainError("invalidRoomParticipants");
  if (!isValidPeriodicity(room.periodicity) || room.responsibleCount <= 0) throw new DomainError("invalidSchedule");
  const existing = state.rooms.find((r) => r.id === room.id);
  if (existing !== undefined) return existing;
  state.rooms.push(room);
  state.roomMemberships.push(...memberships);
  schedulingFor(ctx, state, room.houseID).initializeRooms(room.houseID, room.calendarAnchor ?? now, state);
  const created = state.rooms.find((r) => r.id === room.id);
  if (created === undefined) throw new DomainError("entityNotFound");
  return created;
}
