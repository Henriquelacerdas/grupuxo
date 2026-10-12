import { isBlank, trimmed } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import type { User } from "../entities.ts";
import { DomainError } from "../errors.ts";
import { compareText } from "../arrays.ts";
import { houseMembershipID, sortedIDs, userID as toUserID, type HouseID, type UserID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";

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
  const scheduling = schedulingFor(ctx, state, houseID);
  // Ordem estável por ID: o resultado não deve depender da ordem (testado), mas fica determinístico.
  const roomIDs = sortedIDs(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
  for (const roomID of roomIDs) {
    scheduling.removeMember(userID, roomID, date, state, {
      confirmDeletion: confirmRoomDeletion, houseChange: true, replan: false,
    });
  }
  state.houseMemberships = state.houseMemberships.filter((m) => m.id !== membership.id);
  state.absences = state.absences.filter((a) => a.membershipID !== membership.id);
  scheduling.rebalance(houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
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
