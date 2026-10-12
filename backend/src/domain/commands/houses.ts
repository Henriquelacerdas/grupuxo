import { isBlank, trimmed } from "../arrays.ts";
import { compareText } from "../arrays.ts";
import { createCalendar, type Instant } from "../dates.ts";
import type { House, Room, User } from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  houseID as toHouseID, houseMembershipID, roomID as toRoomID, roomMembershipID, sortedIDs, userID as toUserID,
  type HouseID, type HouseMembershipID, type UserID,
} from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { weeklyPeriodicity } from "../value-objects.ts";
import { schedulingFor, type CommandContext } from "./context.ts";

const MAX_HOUSE_NAME_LENGTH = 80;
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

export function addHouseMember(
  ctx: CommandContext, state: StoreState, rawName: string, houseID: HouseID, requestedBy: UserID, date: Instant,
): User {
  if (isBlank(rawName)) throw new DomainError("invalidResidentName");
  const name = trimmed(rawName);
  if (!state.houses.some((h) => h.id === houseID) ||
    !state.houseMemberships.some((m) => m.houseID === houseID && m.userID === requestedBy)) {
    throw new DomainError("taskUnavailable");
  }
  const user: User = { id: toUserID(ctx.newID()), name, email: null };
  state.users.push(user);
  addExistingUserToHouse(ctx, state, user.id, houseID, date);
  return user;
}

/**
 * Põe um morador que já tem perfil na casa: cria a participação, entra nos cômodos comuns e rebalanceia a escala.
 * Usado por `addHouseMember` (morador novo) e pela entrada por código.
 */
export function addExistingUserToHouse(
  ctx: CommandContext, state: StoreState, userID: UserID, houseID: HouseID, date: Instant,
): void {
  state.houseMemberships.push({ id: houseMembershipID(ctx.newID()), houseID, userID });
  const scheduling = schedulingFor(ctx, state, houseID);
  // `rooms` é copiado: o serviço substitui elementos do array enquanto percorremos.
  for (const room of [...state.rooms]) {
    if (room.houseID === houseID && room.visibility === "common") {
      scheduling.addMember(userID, room.id, date, state, { replan: false });
    }
  }
  scheduling.rebalance(houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
}

export function removeHouseMember(
  ctx: CommandContext, state: StoreState, userID: UserID, houseID: HouseID, requestedBy: UserID, date: Instant,
  confirmRoomDeletion: boolean,
): void {
  if (userID === requestedBy) throw new DomainError("cannotRemoveCurrentUser");
  const membership = state.houseMemberships.find((m) => m.houseID === houseID && m.userID === userID);
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === requestedBy) || membership === undefined) {
    throw new DomainError("taskUnavailable");
  }
  removeMembershipFromHouse(ctx, state, membership.id, userID, houseID, date, confirmRoomDeletion);
}

/** Tira o morador dos cômodos, apaga a participação e as ausências dele e rebalanceia a escala da casa. */
function removeMembershipFromHouse(
  ctx: CommandContext, state: StoreState, membershipID: HouseMembershipID, userID: UserID, houseID: HouseID,
  date: Instant, confirmRoomDeletion: boolean,
): void {
  const scheduling = schedulingFor(ctx, state, houseID);
  // Ordem estável por ID: o resultado não deve depender da ordem (testado), mas fica determinístico.
  const roomIDs = sortedIDs(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
  for (const roomID of roomIDs) {
    scheduling.removeMember(userID, roomID, date, state, {
      confirmDeletion: confirmRoomDeletion, houseChange: true, replan: false,
    });
  }
  state.houseMemberships = state.houseMemberships.filter((m) => m.id !== membershipID);
  state.absences = state.absences.filter((a) => a.membershipID !== membershipID);
  scheduling.rebalance(houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
}

/** Código de convite em maiúsculas, ou `null` se estiver fora do formato (4 a 16 letras ASCII ou dígitos). */
export function normalizeAccessCode(code: string): string | null {
  const normalized = trimmed(code).toUpperCase();
  return ACCESS_CODE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Cria a casa: o fundador é o primeiro morador e participa do cômodo "Casa toda". `newAccessCode` é injetado (o
 * domínio não tem aleatoriedade); a unicidade do código é garantida pelo armazenamento, que pede outro se colidir.
 */
export function createHouse(
  ctx: CommandContext, state: StoreState, founderID: UserID, rawName: string, timezone: string,
  newAccessCode: () => string, date: Instant,
): House {
  const name = trimmed(rawName);
  if (Array.from(name).length === 0 || Array.from(name).length > MAX_HOUSE_NAME_LENGTH || /\p{Cc}/u.test(name)) {
    throw new DomainError("invalidHouseName");
  }
  try {
    createCalendar(timezone);
  } catch {
    throw new DomainError("invalidTimezone");
  }
  const accessCode = normalizeAccessCode(newAccessCode());
  if (accessCode === null) throw new DomainError("invalidAccessCode");
  const house: House = { id: toHouseID(ctx.newID()), name, accessCode, createdAt: date, timezone };
  state.houses.push(house);
  state.houseMemberships.push({ id: houseMembershipID(ctx.newID()), houseID: house.id, userID: founderID });
  const scheduling = schedulingFor(ctx, state, house.id);
  const wholeHouse: Room = {
    id: toRoomID(ctx.newID()), houseID: house.id, name: "Casa toda", kind: "wholeHouse", category: "other",
    visibility: "common", periodicity: weeklyPeriodicity(), responsibleCount: 1,
    calendarAnchor: scheduling.weekStart(date), scheduleVersions: [], icon: "house.fill", color: "blue",
  };
  state.rooms.push(wholeHouse);
  state.roomMemberships.push({
    id: roomMembershipID(ctx.newID()), roomID: wholeHouse.id, userID: founderID, fairnessDebt: 0, leftAt: null,
    rotationChanges: null,
  });
  scheduling.initializeRooms(house.id, date, state);
  return house;
}

/**
 * Entra numa casa existente pelo código de convite. O perfil do morador tem de estar no estado (falha fechada);
 * quem já é da casa recebe a casa de volta, sem replanejar (idempotente).
 */
export function joinHouseByCode(
  ctx: CommandContext, state: StoreState, userID: UserID, code: string, date: Instant,
): House {
  const normalized = normalizeAccessCode(code);
  const house = normalized === null ? undefined : state.houses.find((h) => h.accessCode === normalized);
  if (house === undefined) throw new DomainError("invalidAccessCode");
  if (!state.users.some((u) => u.id === userID)) throw new DomainError("entityNotFound");
  if (state.houseMemberships.some((m) => m.houseID === house.id && m.userID === userID)) return house;
  addExistingUserToHouse(ctx, state, userID, house.id, date);
  return house;
}

/**
 * O próprio morador sai da casa (`removeHouseMember` continua proibindo remover a si mesmo). O último morador não
 * sai. Cômodo em que ele é o último participante só é excluído com `confirmRoomDeletion`.
 */
export function leaveHouse(
  ctx: CommandContext, state: StoreState, userID: UserID, houseID: HouseID, date: Instant, confirmRoomDeletion: boolean,
): void {
  if (!state.houses.some((h) => h.id === houseID)) throw new DomainError("entityNotFound");
  const memberships = state.houseMemberships.filter((m) => m.houseID === houseID);
  const membership = memberships.find((m) => m.userID === userID);
  if (membership === undefined) throw new DomainError("entityNotFound");
  if (memberships.length === 1) throw new DomainError("lastMember");
  removeMembershipFromHouse(ctx, state, membership.id, userID, houseID, date, confirmRoomDeletion);
}

export function houseMembers(state: StoreState, houseID: HouseID): User[] {
  if (!state.houses.some((h) => h.id === houseID)) throw new DomainError("entityNotFound");
  const ids = new Set(state.houseMemberships.filter((m) => m.houseID === houseID).map((m) => m.userID));
  return state.users.filter((u) => ids.has(u.id)).sort((a, b) => compareText(a.name, b.name));
}

export function houseMemberIDs(state: StoreState, houseID: HouseID): UserID[] {
  if (!state.houses.some((h) => h.id === houseID)) throw new DomainError("entityNotFound");
  return state.houseMemberships.filter((m) => m.houseID === houseID).map((m) => m.userID);
}
