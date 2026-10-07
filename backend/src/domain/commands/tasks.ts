import { at, uniqueMap } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import {
  isActiveAssignment, isCompleted, isCurrentMember, taskItem, type Room, type TaskDefinition, type TaskItem,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  taskAssignmentID, type HouseID, type RoomID, type TaskOccurrenceID, type UserID,
} from "../ids.ts";
import { TaskEligibilityPolicy } from "../services/eligibility.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";

const eligibility = new TaskEligibilityPolicy();

function houseOfRoom(state: StoreState, roomID: RoomID): HouseID {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  return room.houseID;
}

function houseOfOccurrence(state: StoreState, occurrenceID: TaskOccurrenceID): HouseID {
  const occurrence = state.occurrences.find((o) => o.id === occurrenceID);
  const definition = occurrence === undefined ? undefined : state.definitions.find((d) => d.id === occurrence.taskDefinitionID);
  if (definition === undefined) throw new DomainError("entityNotFound");
  return houseOfRoom(state, definition.roomID);
}

/** Itens (definição + ocorrência + atribuição) para consultas de tarefas. */
export function taskItems(state: StoreState): TaskItem[] {
  const definitionByID = uniqueMap(state.definitions, (d) => d.id);
  const result: TaskItem[] = [];
  for (const occurrence of state.occurrences) {
    const definition = definitionByID.get(occurrence.taskDefinitionID);
    if (definition === undefined) continue;
    let assignment = state.assignments.find((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a)) ?? null;
    if (assignment === null && isCompleted(occurrence)) {
      for (let i = state.assignments.length - 1; i >= 0; i--) {
        const a = at(state.assignments, i);
        if (a.occurrenceID === occurrence.id && a.userID === occurrence.completedByUserID && a.supersededAt === null &&
          a.endedAt === occurrence.completedAt) {
          assignment = a;
          break;
        }
      }
    }
    const assigneeID = assignment?.userID ?? occurrence.completedByUserID;
    const assignee = assigneeID === null ? null : (state.users.find((u) => u.id === assigneeID) ?? null);
    result.push(taskItem(definition, occurrence, assignment, assignee));
  }
  return result;
}

/** Pendência preservada de quem saiu do cômodo: continua visível até a vigência da saída. */
function retained(item: TaskItem, userID: UserID, state: StoreState): boolean {
  return item.assignment?.userID === userID && state.roomMemberships.some((m) =>
    m.roomID === item.definition.roomID && m.userID === userID && !isCurrentMember(m) &&
    (m.rotationChanges ?? []).some((c) => !c.participates && item.occurrence.availableAt < c.effectiveAt)
  );
}

function canSee(item: TaskItem, room: Room, userID: UserID, state: StoreState): boolean {
  return retained(item, userID, state) || eligibility.canView(item.definition, room, userID, state.roomMemberships);
}

/** Tarefas atribuídas ao usuário, já disponíveis em `date`. Chamar `refreshSchedule` antes. */
export function userTasks(state: StoreState, userID: UserID, houseID: HouseID, date: Instant): TaskItem[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) return [];
  const roomsByID = uniqueMap(state.rooms, (r) => r.id);
  return taskItems(state).filter((item) => {
    const room = roomsByID.get(item.definition.roomID);
    return room !== undefined && room.houseID === houseID && canSee(item, room, userID, state) &&
      item.occurrence.availableAt <= date && item.assignment?.userID === userID;
  });
}

export function roomTasks(state: StoreState, roomID: RoomID, userID: UserID): TaskItem[] {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined || !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID)) return [];
  return taskItems(state).filter((item) =>
    item.definition.roomID === roomID && item.definition.kind !== "sporadic" && canSee(item, room, userID, state)
  );
}

/**
 * Esporádicas da casa. Candidatos são os moradores atuais do cômodo (a tarefa é do cômodo); a carga da
 * semana atual é da casa toda, como na projeção do agendamento. Chamar `refreshSchedule` antes.
 */
export function sporadicTasks(ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, date: Instant): TaskItem[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) return [];
  const roomsByID = uniqueMap(state.rooms, (r) => r.id);
  const tasks = taskItems(state).filter((item) => {
    const room = roomsByID.get(item.definition.roomID);
    return room !== undefined && room.houseID === houseID && item.definition.kind === "sporadic" &&
      canSee(item, room, userID, state);
  });
  const scheduling = schedulingFor(ctx, state, houseID);
  const suggestions = new Map<RoomID, NonNullable<TaskItem["assignee"]>>();
  const roomIDs = new Set(
    tasks.filter((t) => t.assignment === null && !isCompleted(t.occurrence)).map((t) => t.definition.roomID),
  );
  for (const roomID of roomIDs) {
    const suggestedID = scheduling.suggestedResident(roomID, date, state);
    const suggested = suggestedID === null ? undefined : state.users.find((u) => u.id === suggestedID);
    if (suggested !== undefined) suggestions.set(roomID, suggested);
  }
  return tasks.map((item) => {
    const suggested = suggestions.get(item.definition.roomID);
    if (item.assignment !== null || isCompleted(item.occurrence) || suggested === undefined) return item;
    return taskItem(item.definition, item.occurrence, item.assignment, item.assignee, suggested);
  });
}

export function createTask(
  ctx: CommandContext, state: StoreState, definition: TaskDefinition, requestedBy: UserID, date: Instant,
): TaskDefinition {
  const known = state.rooms.find((r) => r.id === definition.roomID);
  if (known !== undefined) schedulingFor(ctx, state, known.houseID).refresh(known.houseID, date, state);
  const room = state.rooms.find((r) => r.id === definition.roomID);
  if (
    room === undefined ||
    !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === requestedBy) ||
    !state.roomMemberships.some((m) => m.roomID === room.id && m.userID === requestedBy && isCurrentMember(m))
  ) {
    throw new DomainError("taskUnavailable");
  }
  return schedulingFor(ctx, state, room.houseID).create(definition, date, state);
}

export function completeTask(ctx: CommandContext, state: StoreState, occurrenceID: TaskOccurrenceID, userID: UserID, date: Instant): void {
  schedulingFor(ctx, state, houseOfOccurrence(state, occurrenceID)).complete(occurrenceID, userID, date, state);
}

export function reopenTask(ctx: CommandContext, state: StoreState, occurrenceID: TaskOccurrenceID, userID: UserID): void {
  schedulingFor(ctx, state, houseOfOccurrence(state, occurrenceID)).reopen(occurrenceID, userID, state);
}

export function refreshSchedule(ctx: CommandContext, state: StoreState, houseID: HouseID, date: Instant): void {
  // Casa desconhecida não tem cômodos: nada a estender (como no Swift, onde o calendário não depende da casa).
  if (!state.houses.some((h) => h.id === houseID)) return;
  schedulingFor(ctx, state, houseID).refresh(houseID, date, state);
}

export function addRoomMember(ctx: CommandContext, state: StoreState, userID: UserID, roomID: RoomID, date: Instant): void {
  schedulingFor(ctx, state, houseOfRoom(state, roomID)).addMember(userID, roomID, date, state);
}

export function removeRoomMember(
  ctx: CommandContext, state: StoreState, userID: UserID, roomID: RoomID, date: Instant, confirmDeletion: boolean,
): void {
  schedulingFor(ctx, state, houseOfRoom(state, roomID)).removeMember(userID, roomID, date, state, { confirmDeletion });
}

export function claimTask(ctx: CommandContext, state: StoreState, occurrenceID: TaskOccurrenceID, userID: UserID, date: Instant): void {
  const occurrenceIndex = state.occurrences.findIndex((o) => o.id === occurrenceID);
  const occurrence = state.occurrences[occurrenceIndex];
  const definition = occurrence === undefined ? undefined : state.definitions.find((d) => d.id === occurrence.taskDefinitionID);
  const room = definition === undefined ? undefined : state.rooms.find((r) => r.id === definition.roomID);
  if (occurrence === undefined || definition === undefined || room === undefined) throw new DomainError("entityNotFound");
  const absent = state.absences.some((absence) =>
    absence.startsAt <= date && date < absence.endsAt &&
    state.houseMemberships.some((m) => m.id === absence.membershipID && m.userID === userID)
  );
  if (
    !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID) ||
    !state.roomMemberships.some((m) => m.roomID === room.id && m.userID === userID && isCurrentMember(m)) ||
    absent || occurrence.availableAt > date || isCompleted(occurrence)
  ) {
    throw new DomainError("taskUnavailable");
  }
  const current = state.assignments.find((a) => a.occurrenceID === occurrenceID && isActiveAssignment(a)) ?? null;
  const item = taskItem(definition, occurrence, current);
  if (!(eligibility.canClaim(item, room, userID, state.roomMemberships) || current?.userID === userID)) {
    throw new DomainError("taskUnavailable");
  }
  if (current !== null) {
    if (current.userID !== userID) throw new DomainError("taskUnavailable");
    return;
  }
  state.assignments.push({
    id: taskAssignmentID(ctx.newID()), occurrenceID, userID, assignedAt: date, endedAt: null, supersededAt: null,
  });
  state.occurrences[occurrenceIndex] = { ...occurrence, status: "assigned" };
}

export function releaseTask(ctx: CommandContext, state: StoreState, occurrenceID: TaskOccurrenceID, userID: UserID): void {
  const assignmentIndex = state.assignments.findIndex((a) =>
    a.occurrenceID === occurrenceID && a.userID === userID && isActiveAssignment(a)
  );
  if (assignmentIndex < 0) return;
  const occurrenceIndex = state.occurrences.findIndex((o) => o.id === occurrenceID);
  const occurrence = state.occurrences[occurrenceIndex];
  if (occurrence === undefined || isCompleted(occurrence) ||
    !state.definitions.some((d) => d.id === occurrence.taskDefinitionID && d.kind === "sporadic")) {
    throw new DomainError("taskUnavailable");
  }
  const definition = state.definitions.find((d) => d.id === occurrence.taskDefinitionID);
  const room = definition === undefined ? undefined : state.rooms.find((r) => r.id === definition.roomID);
  if (room === undefined || !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID)) {
    throw new DomainError("taskUnavailable");
  }
  state.assignments[assignmentIndex] = { ...at(state.assignments, assignmentIndex), endedAt: ctx.now() };
  state.occurrences[occurrenceIndex] = { ...occurrence, status: "available" };
}
