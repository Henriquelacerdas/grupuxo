import { at, isBlank, lastWhere, trimmed } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import {
  isCurrentMember, representsWholeHouse, type Room, type RoomMembership, type RoomParticipation,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, RoomID, UserID } from "../ids.ts";
import {
  isValidPeriodicity, samePeriodicity, weeklyRecurrence, type RoomCategory, type RoomColor, type WeeklyPeriodicity,
} from "../value-objects.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";
import { buildNotification, notifyAll, roomAudienceIDs } from "./notifications.ts";
import { pruneDanglingReferences } from "./references.ts";

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

/** `roomParticipation` não mudaria o estado: a escala dos cômodos da casa já foi inicializada. */
export function roomScheduleReady(ctx: CommandContext, state: StoreState, roomID: RoomID): boolean {
  const room = state.rooms.find((r) => r.id === roomID);
  // Sem o cômodo, `roomParticipation` lança `entityNotFound` sem mudar nada.
  if (room === undefined) return true;
  return schedulingFor(ctx, state, room.houseID).roomsInitialized(room.houseID, state);
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
  const responsibles = (periodIndex: number, when: Instant): string[] => {
    const names: string[] = [];
    const version = lastWhere(updated.scheduleVersions, (v) => v.effectiveAt <= when);
    if (isMember && version !== undefined && version.queue.length > 0) {
      for (let role = 0; role < version.responsibleCount; role++) {
        const slot = (periodIndex - version.periodIndex) * version.responsibleCount + role;
        const user = at(version.queue, slot % version.queue.length);
        const name = state.users.find((u) => u.id === user)?.name;
        if (name !== undefined) names.push(name);
      }
    }
    return names;
  };
  return {
    room: visibleRoom(updated, userID, state), isMember, memberCount: isMember ? members.length : 0,
    responsibleNames: responsibles(period, date), nextResponsibleNames: responsibles(period + 1, end),
    periodStart: start, periodEnd: end,
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

// ---------- Editar e excluir cômodo ----------

/** Campos já validados de um `PATCH /rooms/{id}`; o que não vem fica como está. */
export interface RoomPatch {
  readonly name?: string;
  readonly category?: RoomCategory;
  readonly icon?: string;
  readonly color?: RoomColor;
  readonly periodicity?: WeeklyPeriodicity;
  readonly responsibleCount?: number;
}

/**
 * O cômodo que o morador pode alterar: é da casa dele e, se for privado, ele participa. Quem não pode recebe
 * `entityNotFound` (igual a um cômodo que não existe) e "Casa toda" recebe `wholeHouseProtected`.
 */
function editableRoom(state: StoreState, roomID: RoomID, userID: UserID): Room {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, userID);
  const participates = state.roomMemberships.some((m) => m.roomID === roomID && m.userID === userID && isCurrentMember(m));
  if (room.visibility === "privateRoom" && !participates) throw new DomainError("entityNotFound");
  if (representsWholeHouse(room)) throw new DomainError("wholeHouseProtected");
  return room;
}

/**
 * Edita o cômodo. Nome, categoria, ícone e cor valem na hora. Periodicidade e número de responsáveis replanejam a
 * escala a partir da próxima segunda (como entrar ou sair de um cômodo): as tarefas que acompanham o cômodo passam
 * para a periodicidade nova, e as atribuições desta semana não mudam.
 */
export function updateRoom(
  ctx: CommandContext, state: StoreState, roomID: RoomID, patch: RoomPatch, requestedBy: UserID, date: Instant,
): Room {
  const room = editableRoom(state, roomID, requestedBy);
  if (patch.name !== undefined && isBlank(patch.name)) throw new DomainError("invalidRoomName");
  const periodicity = patch.periodicity ?? room.periodicity;
  const responsibleCount = patch.responsibleCount ?? room.responsibleCount;
  if (!isValidPeriodicity(periodicity) || !Number.isSafeInteger(responsibleCount) || responsibleCount <= 0) {
    throw new DomainError("invalidSchedule");
  }
  const reschedules = !samePeriodicity(periodicity, room.periodicity) || responsibleCount !== room.responsibleCount;
  const scheduling = schedulingFor(ctx, state, room.houseID);
  // Materializa o calendário antigo antes de mudar a periodicidade, inclusive semanas perdidas.
  if (reschedules) scheduling.refresh(room.houseID, date, state);
  const linkedIDs = reschedules && !samePeriodicity(periodicity, room.periodicity)
    ? new Set(state.definitions.filter((d) => d.roomID === roomID && scheduling.isRoomLinked(d, state)).map((d) => d.id))
    : new Set<string>();
  const updated: Room = {
    ...room,
    ...(patch.name === undefined ? {} : { name: trimmed(patch.name) }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
    ...(patch.icon === undefined ? {} : { icon: patch.icon }),
    ...(patch.color === undefined ? {} : { color: patch.color }),
    periodicity, responsibleCount,
  };
  state.rooms = state.rooms.map((r) => (r.id === roomID ? updated : r));
  if (linkedIDs.size > 0) {
    state.definitions = state.definitions.map((d) => (linkedIDs.has(d.id) ? { ...d, recurrence: weeklyRecurrence(periodicity) } : d));
  }
  if (reschedules) scheduling.rebalance(room.houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
  const result = state.rooms.find((r) => r.id === roomID);
  if (result === undefined) throw new DomainError("entityNotFound");
  return result;
}

/**
 * Exclui o cômodo com tudo o que é dele (tarefas, ocorrências, atribuições, participações, trocas e avisos). Exige
 * `confirmDeletion` (senão `deletionConfirmationRequired`). Quem acompanhava o cômodo (menos quem apagou) é avisado,
 * com o nome de então, e a escala dos outros cômodos é replanejada a partir da próxima segunda.
 */
export function deleteRoom(
  ctx: CommandContext, state: StoreState, roomID: RoomID, requestedBy: UserID, date: Instant, confirmDeletion: boolean,
): void {
  const room = editableRoom(state, roomID, requestedBy);
  if (!confirmDeletion) throw new DomainError("deletionConfirmationRequired");
  const audience = roomAudienceIDs(state, roomID);
  const scheduling = schedulingFor(ctx, state, room.houseID);
  scheduling.refresh(room.houseID, date, state);
  scheduling.deleteRoom(roomID, state);
  scheduling.rebalance(room.houseID, scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
  pruneDanglingReferences(state);
  notifyAll(ctx, state, audience, requestedBy, room.houseID, "roomDeleted", date, {
    actorUserID: requestedBy, subjectName: room.name,
  });
}

// ---------- Pedido de entrada em cômodo privado ----------

/** Cômodo privado da casa do morador de que ele ainda não participa; senão `roomAccessNotRequestable`. */
function requestableRoom(state: StoreState, roomID: RoomID, userID: UserID): Room {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, userID);
  const participates = state.roomMemberships.some((m) => m.roomID === roomID && m.userID === userID && isCurrentMember(m));
  if (room.visibility !== "privateRoom" || participates) throw new DomainError("roomAccessNotRequestable");
  return room;
}

/** Cômodos privados da casa para os quais o morador tem pedido aberto. */
export function pendingRoomAccessIDs(state: StoreState, houseID: HouseID, userID: UserID): RoomID[] {
  const inHouse = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
  return state.roomAccessRequests.filter((r) => r.userID === userID && inHouse.has(r.roomID)).map((r) => r.roomID).sort();
}

/** Pedidos abertos para o cômodo. Só quem participa dele os vê; para os outros, `entityNotFound`. */
export function roomAccessRequestsFor(state: StoreState, roomID: RoomID, requesting: UserID): readonly { userID: UserID; requestedAt: Instant }[] {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, requesting);
  if (!state.roomMemberships.some((m) => m.roomID === roomID && m.userID === requesting && isCurrentMember(m))) {
    throw new DomainError("entityNotFound");
  }
  return state.roomAccessRequests
    .filter((r) => r.roomID === roomID)
    .map((r) => ({ userID: r.userID, requestedAt: r.requestedAt }))
    .sort((a, b) => a.requestedAt - b.requestedAt || (a.userID < b.userID ? -1 : a.userID > b.userID ? 1 : 0));
}

/** Idempotente: pedir de novo não cria outro pedido nem outro aviso. Avisa quem participa do cômodo. */
export function requestRoomAccess(ctx: CommandContext, state: StoreState, roomID: RoomID, userID: UserID, date: Instant): void {
  const room = requestableRoom(state, roomID, userID);
  if (state.roomAccessRequests.some((r) => r.roomID === roomID && r.userID === userID)) return;
  state.roomAccessRequests.push({ roomID, userID, requestedAt: date });
  notifyAll(ctx, state, roomAudienceIDs(state, roomID), userID, room.houseID, "roomAccessRequested", date, {
    roomID, actorUserID: userID, subjectName: room.name,
  });
}

/** Idempotente. Os avisos do pedido saem junto (ninguém precisa decidir um pedido que não existe mais). */
export function cancelRoomAccess(state: StoreState, roomID: RoomID, userID: UserID): void {
  state.roomAccessRequests = state.roomAccessRequests.filter((r) => !(r.roomID === roomID && r.userID === userID));
  state.notifications = state.notifications.filter((n) =>
    !(n.kind === "roomAccessRequested" && n.roomID === roomID && n.actorUserID === userID)
  );
}

/**
 * Quem participa do cômodo aprova ou recusa o pedido (qualquer participante; o criador da casa não tem poderes
 * especiais, docs/DESIGN.md). Aprovar põe o morador no cômodo como `addRoomMember`. Os dois avisam quem pediu.
 */
export function answerRoomAccess(
  ctx: CommandContext, state: StoreState, roomID: RoomID, requesterID: UserID, answeredBy: UserID, approve: boolean, date: Instant,
): void {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  requireHouseMember(state, room.houseID, answeredBy);
  if (!state.roomMemberships.some((m) => m.roomID === roomID && m.userID === answeredBy && isCurrentMember(m))) {
    throw new DomainError("entityNotFound");
  }
  if (!state.roomAccessRequests.some((r) => r.roomID === roomID && r.userID === requesterID)) throw new DomainError("entityNotFound");
  cancelRoomAccess(state, roomID, requesterID);
  if (approve) schedulingFor(ctx, state, room.houseID).addMember(requesterID, roomID, date, state);
  state.notifications.push(buildNotification(
    ctx, requesterID, room.houseID, approve ? "roomAccessApproved" : "roomAccessDenied", date,
    { roomID, actorUserID: answeredBy, subjectName: room.name },
  ));
}
