import { isBlank, trimmed } from "../arrays.ts";
import { compareText } from "../arrays.ts";
import { createCalendar, DISTANT_FUTURE, type Instant } from "../dates.ts";
import { createAbsence, type House, type Room, type User } from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  absenceID, houseID as toHouseID, houseMembershipID, roomID as toRoomID, roomMembershipID, sortedIDs, userID as toUserID,
  type HouseID, type HouseMembershipID, type UserID,
} from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { weeklyPeriodicity } from "../value-objects.ts";
import { schedulingFor, type CommandContext } from "./context.ts";
import { houseResidentIDs, notifyAll } from "./notifications.ts";
import { pruneDanglingReferences } from "./references.ts";

const MAX_HOUSE_NAME_LENGTH = 80;
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/** Quantos códigos o adaptador gera antes de desistir de uma casa nova quando o código já é de outra casa. */
export const ACCESS_CODE_ATTEMPTS = 5;

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
  notifyAll(ctx, state, houseResidentIDs(state, houseID), userID, houseID, "memberJoined", date, {
    actorUserID: userID, subjectName: state.users.find((u) => u.id === userID)?.name ?? "",
  });
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
  state.roomAccessRequests = state.roomAccessRequests.filter((r) => r.userID !== userID);
  pruneDanglingReferences(state);
  // Quem saiu não vê mais os avisos da casa; os outros moradores sabem que saiu (com o nome de então).
  state.notifications = state.notifications.filter((n) => !(n.recipientUserID === userID && n.houseID === houseID));
  notifyAll(ctx, state, houseResidentIDs(state, houseID), userID, houseID, "memberLeft", date, {
    actorUserID: userID, subjectName: state.users.find((u) => u.id === userID)?.name ?? "",
  });
  scheduling.rebalance(houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
}

/** Código de convite em maiúsculas, ou `null` se estiver fora do formato (4 a 16 letras ASCII ou dígitos). */
export function normalizeAccessCode(code: string): string | null {
  const normalized = trimmed(code).toUpperCase();
  return ACCESS_CODE_PATTERN.test(normalized) ? normalized : null;
}

/** Nome da casa sem espaços nas pontas, de 1 a 80 caracteres e sem caracteres de controle (`invalidHouseName`). */
function validHouseName(rawName: string): string {
  const name = trimmed(rawName);
  if (Array.from(name).length === 0 || Array.from(name).length > MAX_HOUSE_NAME_LENGTH || /\p{Cc}/u.test(name)) {
    throw new DomainError("invalidHouseName");
  }
  return name;
}

/**
 * Muda o nome da casa. Qualquer morador pode: a casa não tem dono (docs/DESIGN.md). Quem não é da casa recebe
 * `entityNotFound`, o mesmo de uma casa que não existe, para não revelar nada.
 */
export function renameHouse(state: StoreState, houseID: HouseID, requestedBy: UserID, rawName: string): House {
  const house = state.houses.find((h) => h.id === houseID);
  if (house === undefined || !state.houseMemberships.some((m) => m.houseID === houseID && m.userID === requestedBy)) {
    throw new DomainError("entityNotFound");
  }
  const renamed: House = { ...house, name: validHouseName(rawName) };
  state.houses = state.houses.map((h) => (h.id === houseID ? renamed : h));
  return renamed;
}

/**
 * Cria a casa: o fundador é o primeiro morador e participa do cômodo "Casa toda". `newAccessCode` é injetado (o
 * domínio não tem aleatoriedade); a unicidade do código é garantida pelo armazenamento, que pede outro se colidir.
 */
export function createHouse(
  ctx: CommandContext, state: StoreState, founderID: UserID, rawName: string, timezone: string,
  newAccessCode: () => string, date: Instant,
): House {
  const name = validHouseName(rawName);
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
    rotationChanges: null, skipsNextOwnTurn: false,
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

/** O que aconteceu ao sair da casa. */
export type LeaveHouseOutcome = "left" | "houseDeleted";

/**
 * O próprio morador sai da casa (`removeHouseMember` continua proibindo remover a si mesmo). Cômodo em que ele é o
 * último participante só é excluído com `confirmRoomDeletion`. O último morador só sai com `confirmHouseDeletion`
 * (senão `houseDeletionConfirmationRequired`), e a casa é excluída inteira com ele.
 */
export function leaveHouse(
  ctx: CommandContext, state: StoreState, userID: UserID, houseID: HouseID, date: Instant, confirmRoomDeletion: boolean,
  confirmHouseDeletion = false,
): LeaveHouseOutcome {
  if (!state.houses.some((h) => h.id === houseID)) throw new DomainError("entityNotFound");
  const memberships = state.houseMemberships.filter((m) => m.houseID === houseID);
  const membership = memberships.find((m) => m.userID === userID);
  if (membership === undefined) throw new DomainError("entityNotFound");
  if (memberships.length === 1) {
    if (!confirmHouseDeletion) throw new DomainError("houseDeletionConfirmationRequired");
    deleteHouse(state, houseID);
    return "houseDeleted";
  }
  removeMembershipFromHouse(ctx, state, membership.id, userID, houseID, date, confirmRoomDeletion);
  return "left";
}

/**
 * Apaga a casa e tudo o que é dela: participações, ausências, cômodos, tarefas, ocorrências, atribuições, trocas e
 * notificações. Os perfis dos moradores ficam (a conta não é da casa).
 */
function deleteHouse(state: StoreState, houseID: HouseID): void {
  const membershipIDs = new Set(state.houseMemberships.filter((m) => m.houseID === houseID).map((m) => m.id));
  const roomIDs = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
  const definitionIDs = new Set(state.definitions.filter((d) => roomIDs.has(d.roomID)).map((d) => d.id));
  const occurrenceIDs = new Set(state.occurrences.filter((o) => definitionIDs.has(o.taskDefinitionID)).map((o) => o.id));
  const swapIDs = new Set(state.taskSwapRequests
    .filter((s) => occurrenceIDs.has(s.offeredOccurrenceID) || occurrenceIDs.has(s.requestedOccurrenceID))
    .map((s) => s.id));
  state.houses = state.houses.filter((h) => h.id !== houseID);
  state.houseMemberships = state.houseMemberships.filter((m) => !membershipIDs.has(m.id));
  state.absences = state.absences.filter((a) => !membershipIDs.has(a.membershipID));
  state.rooms = state.rooms.filter((r) => !roomIDs.has(r.id));
  state.roomMemberships = state.roomMemberships.filter((m) => !roomIDs.has(m.roomID));
  state.definitions = state.definitions.filter((d) => !definitionIDs.has(d.id));
  state.occurrences = state.occurrences.filter((o) => !occurrenceIDs.has(o.id));
  state.assignments = state.assignments.filter((a) => !occurrenceIDs.has(a.occurrenceID));
  state.taskSwapRequests = state.taskSwapRequests.filter((s) => !swapIDs.has(s.id));
  state.notifications = state.notifications.filter((n) => n.houseID !== houseID);
  state.roomAccessRequests = state.roomAccessRequests.filter((r) => !roomIDs.has(r.roomID));
  state.roomRatings = state.roomRatings.filter((r) => !roomIDs.has(r.roomID));
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

// ---------- Modo férias ----------

/** Estado do modo férias do morador: ligado desde `startsAt` (que pode ser futuro: "a partir do próximo ciclo"). */
export interface VacationStatus {
  readonly onVacation: boolean;
  readonly startsAt: Instant | null;
}

function membershipOf(state: StoreState, houseID: HouseID, userID: UserID) {
  const membership = state.houseMemberships.find((m) => m.houseID === houseID && m.userID === userID);
  if (membership === undefined) throw new DomainError("entityNotFound");
  return membership;
}

/** A ausência aberta (sem data de volta) do morador: o modo férias ligado. */
function openAbsence(state: StoreState, membershipID: HouseMembershipID) {
  return state.absences.find((a) => a.membershipID === membershipID && a.endsAt === DISTANT_FUTURE);
}

export function vacationStatus(state: StoreState, houseID: HouseID, userID: UserID): VacationStatus {
  const absence = openAbsence(state, membershipOf(state, houseID, userID).id);
  return absence === undefined ? { onVacation: false, startsAt: null } : { onVacation: true, startsAt: absence.startsAt };
}

/**
 * Liga ou desliga o modo férias (ausência sem data de volta). Ligar vale a partir da próxima segunda ("do próximo
 * ciclo"): as atribuições desta semana não mudam, e a escala é replanejada dali em diante (a vez do ausente é pulada e
 * consome a posição da fila, ALGORITMO.md). Desligar antes de começar apaga a ausência; depois de começar, fecha em
 * `date`, e a escala volta a incluí-lo a partir da próxima segunda. Idempotente nos dois sentidos.
 */
export function setVacation(
  ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, on: boolean, date: Instant,
): VacationStatus {
  const membership = membershipOf(state, houseID, userID);
  const scheduling = schedulingFor(ctx, state, houseID);
  const boundary = scheduling.addingWeeks(1, scheduling.weekStart(date));
  const open = openAbsence(state, membership.id);
  if (on) {
    if (open !== undefined) return { onVacation: true, startsAt: open.startsAt };
    state.absences.push(createAbsence({ id: absenceID(ctx.newID()), membershipID: membership.id, startsAt: boundary, endsAt: DISTANT_FUTURE }));
    scheduling.rebalance(houseID, boundary, date, state);
    return { onVacation: true, startsAt: boundary };
  }
  if (open === undefined) return { onVacation: false, startsAt: null };
  state.absences = open.startsAt > date
    ? state.absences.filter((a) => a.id !== open.id)
    : state.absences.map((a) => (a.id === open.id ? { ...a, endsAt: date } : a));
  scheduling.rebalance(houseID, boundary, date, state);
  return { onVacation: false, startsAt: null };
}
