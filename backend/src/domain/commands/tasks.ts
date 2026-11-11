import { at, uniqueMap } from "../arrays.ts";
import { createCalendar, type Instant } from "../dates.ts";
import {
  isActiveAssignment, isCompleted, isCurrentMember, taskItem, type Room, type TaskAssignment, type TaskDefinition, type TaskItem,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  taskAssignmentID, type HouseID, type RoomID, type TaskDefinitionID, type TaskOccurrenceID, type UserID,
} from "../ids.ts";
import { hasValidInterval, isRepeating, sameRecurrence, type RecurrencePolicy, type TaskEffort } from "../value-objects.ts";
import { TaskEligibilityPolicy } from "../services/eligibility.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";
import { buildNotification, notifyAll, roomAudienceIDs } from "./notifications.ts";
import { pruneDanglingReferences } from "./references.ts";

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

/**
 * Definição de uma tarefa do cômodo (inclusive encerrada). Quem não é da casa, ou não pode ver a tarefa, recebe o
 * mesmo `entityNotFound` de uma tarefa que não existe.
 */
export function taskDefinitionFor(state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, userID: UserID): TaskDefinition {
  const room = state.rooms.find((r) => r.id === roomID);
  const definition = state.definitions.find((d) => d.id === taskID && d.roomID === roomID);
  if (
    room === undefined || definition === undefined ||
    !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID) ||
    !eligibility.canView(definition, room, userID, state.roomMemberships)
  ) {
    throw new DomainError("entityNotFound");
  }
  return definition;
}

/** Casa da ocorrência, se o morador for dela; senão `entityNotFound` (igual a uma ocorrência que não existe). */
export function occurrenceHouseFor(state: StoreState, occurrenceID: TaskOccurrenceID, userID: UserID): HouseID {
  const houseID = houseOfOccurrence(state, occurrenceID);
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) throw new DomainError("entityNotFound");
  return houseID;
}

/** Itens (definição + ocorrência + atribuição) para consultas de tarefas. */
export function taskItems(state: StoreState): TaskItem[] {
  const definitionByID = uniqueMap(state.definitions, (d) => d.id);
  const usersByID = uniqueMap(state.users, (user) => user.id);
  const activeByOccurrence = new Map<TaskOccurrenceID, TaskAssignment>();
  const endedByOccurrence = new Map<TaskOccurrenceID, TaskAssignment[]>();
  for (const assignment of state.assignments) {
    if (isActiveAssignment(assignment) && !activeByOccurrence.has(assignment.occurrenceID)) {
      activeByOccurrence.set(assignment.occurrenceID, assignment);
    }
    if (assignment.supersededAt === null && assignment.endedAt !== null) {
      const ended = endedByOccurrence.get(assignment.occurrenceID) ?? [];
      ended.push(assignment);
      endedByOccurrence.set(assignment.occurrenceID, ended);
    }
  }
  const result: TaskItem[] = [];
  for (const occurrence of state.occurrences) {
    const definition = definitionByID.get(occurrence.taskDefinitionID);
    if (definition === undefined) continue;
    let assignment = activeByOccurrence.get(occurrence.id) ?? null;
    if (assignment === null && isCompleted(occurrence)) {
      const ended = endedByOccurrence.get(occurrence.id) ?? [];
      for (let index = ended.length - 1; index >= 0; index--) {
        const candidate = at(ended, index);
        if (candidate.userID === occurrence.completedByUserID && candidate.endedAt === occurrence.completedAt) {
          assignment = candidate;
          break;
        }
      }
    }
    const assigneeID = assignment?.userID ?? occurrence.completedByUserID;
    const assignee = assigneeID === null ? null : (usersByID.get(assigneeID) ?? null);
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

/**
 * Tarefas atribuídas ao usuário que já estão disponíveis em `date` **ou** que ficam disponíveis ainda nesta semana
 * (segunda 00:00 do fuso da casa até a segunda seguinte): a vez dele daqui a dois dias já aparece hoje. As futuras
 * só aparecem; concluir, oferecer troca etc. continuam exigindo `availableAt <= date`. Chamar `refreshSchedule` antes.
 */
export function userTasks(state: StoreState, userID: UserID, houseID: HouseID, date: Instant, items = taskItems(state)): TaskItem[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) return [];
  const house = state.houses.find((candidate) => candidate.id === houseID);
  const calendar = house === undefined ? undefined : createCalendar(house.timezone);
  const horizon = calendar === undefined ? date : Math.max(date, calendar.addWeeks(calendar.weekStart(date), 1) - 1);
  const roomsByID = uniqueMap(state.rooms, (r) => r.id);
  return items.filter((item) => {
    const room = roomsByID.get(item.definition.roomID);
    return room !== undefined && room.houseID === houseID && canSee(item, room, userID, state) &&
      item.occurrence.availableAt <= horizon && item.assignment?.userID === userID;
  });
}

export function roomTasks(state: StoreState, roomID: RoomID, userID: UserID, items = taskItems(state)): TaskItem[] {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined || !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID)) return [];
  return items.filter((item) =>
    item.definition.roomID === roomID && item.definition.kind !== "sporadic" && canSee(item, room, userID, state)
  );
}

/**
 * Esporádicas da casa. Candidatos são os moradores atuais do cômodo (a tarefa é do cômodo); a carga da
 * semana atual é da casa toda, como na projeção do agendamento. Chamar `refreshSchedule` antes.
 */
export function sporadicTasks(ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, date: Instant, items = taskItems(state)): TaskItem[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) return [];
  const roomsByID = uniqueMap(state.rooms, (r) => r.id);
  const tasks = items.filter((item) => {
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

/**
 * Encerra a tarefa (ver `TaskSchedulingService.endTask`). As trocas pendentes que citam uma ocorrência removida seriam
 * impossíveis de aceitar: viram recusadas e avisam quem pediu (o estado de agendamento não guarda trocas).
 */
export function endTask(
  ctx: CommandContext, state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, requestedBy: UserID, date: Instant,
): void {
  const definition = state.definitions.find((d) => d.id === taskID && d.roomID === roomID);
  if (definition === undefined) throw new DomainError("entityNotFound");
  const houseID = houseOfRoom(state, definition.roomID);
  const wasActive = definition.endedAt === null;
  const removed = new Set(schedulingFor(ctx, state, houseID).endTask(taskID, requestedBy, date, state));
  if (wasActive) {
    notifyAll(ctx, state, roomAudienceIDs(state, roomID), requestedBy, houseID, "taskDeleted", date, {
      taskDefinitionID: taskID, roomID, actorUserID: requestedBy, subjectName: definition.name,
    });
  }
  rejectSwapsOfRemoved(ctx, state, removed, houseID, requestedBy, date);
}

/** As trocas pendentes que citam uma ocorrência removida viram recusadas e avisam quem pediu. */
function rejectSwapsOfRemoved(
  ctx: CommandContext, state: StoreState, removed: ReadonlySet<TaskOccurrenceID>, houseID: HouseID, actor: UserID, date: Instant,
): void {
  if (removed.size === 0) return;
  state.taskSwapRequests.forEach((request, index) => {
    if (request.status !== "pending" || !(removed.has(request.offeredOccurrenceID) || removed.has(request.requestedOccurrenceID))) return;
    state.taskSwapRequests[index] = { ...request, status: "rejected", resolvedAt: date };
    state.notifications.push(buildNotification(ctx, request.requesterID, houseID, "taskSwapRejected", date, {
      swapRequestID: request.id, actorUserID: actor,
    }));
  });
}

/** Campos já validados de `UpdateTaskDetailsUseCase`; o que não vem fica como está. */
export interface TaskDetailsPatch {
  readonly name?: string;
  readonly details?: string;
  readonly effort?: TaskEffort;
  /** Só tarefa de repetição própria muda o intervalo (ver `updateTaskDetails`); ao sair do cômodo, é o novo intervalo. */
  readonly recurrence?: RecurrencePolicy;
  /** Passa a tarefa recorrente para "Repetir com o cômodo" (`true`) ou para repetição própria (`false`, com `recurrence`). */
  readonly followsRoom?: boolean;
}

/**
 * A tarefa que o morador pode editar: a **avulsa** é de quem a criou; a **recorrente** (ativa) é de qualquer participante
 * atual do cômodo, como encerrar. Em ambos, quem edita ainda é da casa; senão `taskUnavailable`.
 */
function editableDefinition(
  state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, userID: UserID,
): { readonly definition: TaskDefinition; readonly index: number } {
  const index = state.definitions.findIndex((d) => d.id === taskID && d.roomID === roomID);
  const definition = state.definitions[index];
  const room = state.rooms.find((r) => r.id === roomID);
  if (definition === undefined || room === undefined) throw new DomainError("entityNotFound");
  const participates = state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID) &&
    state.roomMemberships.some((m) => m.roomID === roomID && m.userID === userID && isCurrentMember(m));
  const allowed = definition.kind === "sporadic"
    ? definition.createdByUserID === userID
    : definition.endedAt === null;
  if (!allowed || !participates) throw new DomainError("taskUnavailable");
  return { definition, index };
}

/** Só a avulsa do próprio morador pode ser excluída. */
function ownSporadicDefinition(
  state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, userID: UserID,
): { readonly definition: TaskDefinition; readonly index: number } {
  const found = editableDefinition(state, roomID, taskID, userID);
  if (found.definition.kind !== "sporadic") throw new DomainError("taskUnavailable");
  return found;
}

/**
 * Edita a tarefa. Nome e descrição valem na hora, inclusive para o histórico (a definição é separada das ocorrências).
 * Mudar o esforço reescreve o `effortSnapshot` das ocorrências ainda não concluídas (as concluídas já geraram seu impacto
 * no saldo e não mudam); numa tarefa que acompanha o cômodo, a escala do cômodo é replanejada a partir da próxima
 * segunda, porque a divisão de papéis depende do esforço. Só a tarefa de **repetição própria** (`afterCompletion`)
 * muda o intervalo (vale a partir da próxima janela). `followsRoom` passa a tarefa entre "Repetir com o cômodo" e
 * repetição própria (`TaskSchedulingService.convertRepetition`): a vez aberta e as futuras saem, a tarefa é reagendada
 * no novo modo e as trocas pendentes que citam essas ocorrências são recusadas; só tarefa recorrente (`invalidSchedule`
 * para avulsa) e, ao ir para repetição própria, com um intervalo válido. Avisa quem acompanha o cômodo (menos quem
 * editou).
 */
export function updateTaskDetails(
  ctx: CommandContext, state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, patch: TaskDetailsPatch,
  requestedBy: UserID, date: Instant,
): TaskDefinition {
  const { definition, index } = editableDefinition(state, roomID, taskID, requestedBy);
  const scheduling = schedulingFor(ctx, state, houseOfRoom(state, roomID));
  const linked = scheduling.isRoomLinked(definition, state);
  if (patch.followsRoom !== undefined && definition.kind !== "recurring") throw new DomainError("invalidSchedule");
  const switching = patch.followsRoom !== undefined && patch.followsRoom !== linked;
  // Ao trocar de modo, o intervalo novo (se houver) é validado pela conversão; senão só a repetição própria o muda.
  const changesInterval = patch.recurrence !== undefined && !switching && !sameRecurrence(patch.recurrence, definition.recurrence);
  if (changesInterval && patch.recurrence !== undefined) {
    const own = definition.kind === "recurring" && definition.assignmentPolicy === "afterCompletion";
    if (!own || !isRepeating(patch.recurrence) || !hasValidInterval(patch.recurrence)) throw new DomainError("invalidSchedule");
  }
  const updated: TaskDefinition = {
    ...definition,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.details === undefined ? {} : { details: patch.details }),
    ...(patch.effort === undefined ? {} : { effort: patch.effort }),
    ...(patch.recurrence === undefined || switching ? {} : { recurrence: patch.recurrence }),
  };
  state.definitions[index] = updated;
  const effort = patch.effort;
  const effortChanged = effort !== undefined && effort.points !== definition.effort.points;
  if (effort !== undefined && effortChanged) {
    state.occurrences = state.occurrences.map((o) =>
      o.taskDefinitionID === taskID && !isCompleted(o) ? { ...o, effortSnapshot: effort } : o
    );
    if (linked) scheduling.rebalance(houseOfRoom(state, roomID), scheduling.addingWeeks(1, scheduling.weekStart(date)), date, state);
  }
  if (switching && patch.followsRoom !== undefined) {
    const houseID = houseOfRoom(state, roomID);
    const removed = scheduling.convertRepetition(
      taskID, patch.followsRoom, patch.recurrence ?? null, requestedBy, date, state,
    );
    rejectSwapsOfRemoved(ctx, state, new Set(removed), houseID, requestedBy, date);
  }
  const result = state.definitions.find((d) => d.id === taskID) ?? updated;
  notifyTaskEdited(ctx, state, definition, result, requestedBy, date, effortChanged);
  return result;
}

/**
 * Avisa a quem acompanha o cômodo (menos quem editou) que a tarefa mudou: "editada" se o nome ou a descrição mudaram,
 * "esforço mudou" se o esforço mudou. A designer quer o histórico notificado para evitar edição silenciosa.
 */
export function notifyTaskEdited(
  ctx: CommandContext, state: StoreState, before: TaskDefinition, after: TaskDefinition, actor: UserID, date: Instant,
  effortChanged: boolean,
): void {
  const houseID = houseOfRoom(state, after.roomID);
  const audience = roomAudienceIDs(state, after.roomID);
  const refs = { taskDefinitionID: after.id, roomID: after.roomID, actorUserID: actor, subjectName: after.name };
  if (before.name !== after.name || before.details !== after.details) {
    notifyAll(ctx, state, audience, actor, houseID, "taskEdited", date, refs);
  }
  if (effortChanged) notifyAll(ctx, state, audience, actor, houseID, "effortChanged", date, refs);
}

/**
 * Exclusão física da avulsa. As trocas que citam suas ocorrências, de qualquer status, somem junto com as
 * notificações delas (notificação sempre carrega o `swapRequestID`).
 */
export function deleteSporadicTask(
  ctx: CommandContext, state: StoreState, roomID: RoomID, taskID: TaskDefinitionID, requestedBy: UserID, date: Instant,
): void {
  const { definition } = ownSporadicDefinition(state, roomID, taskID, requestedBy);
  const occurrences = new Set(state.occurrences.filter((o) => o.taskDefinitionID === taskID).map((o) => o.id));
  const swaps = new Set(
    state.taskSwapRequests
      .filter((r) => occurrences.has(r.offeredOccurrenceID) || occurrences.has(r.requestedOccurrenceID))
      .map((r) => r.id),
  );
  // Avisos que citam a tarefa (ou as trocas dela) apontariam para nada: saem junto, e o aviso de exclusão guarda só o nome.
  state.notifications = state.notifications.filter((n) =>
    !(n.swapRequestID !== null && swaps.has(n.swapRequestID)) && n.taskDefinitionID !== taskID
  );
  state.taskSwapRequests = state.taskSwapRequests.filter((r) => !swaps.has(r.id));
  state.assignments = state.assignments.filter((a) => !occurrences.has(a.occurrenceID));
  state.occurrences = state.occurrences.filter((o) => o.taskDefinitionID !== taskID);
  state.definitions = state.definitions.filter((d) => d.id !== taskID);
  notifyAll(ctx, state, roomAudienceIDs(state, roomID), requestedBy, houseOfRoom(state, roomID), "taskDeleted", date, {
    roomID, actorUserID: requestedBy, subjectName: definition.name,
  });
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

/** `refreshSchedule` não mudaria nada: a consulta pode ler o estado sem gravar (ver `TaskSchedulingService.isCurrent`). */
export function scheduleIsCurrent(ctx: CommandContext, state: StoreState, houseID: HouseID, date: Instant): boolean {
  if (!state.houses.some((h) => h.id === houseID)) return true;
  return schedulingFor(ctx, state, houseID).isCurrent(houseID, date, state);
}

export function addRoomMember(ctx: CommandContext, state: StoreState, userID: UserID, roomID: RoomID, date: Instant): void {
  schedulingFor(ctx, state, houseOfRoom(state, roomID)).addMember(userID, roomID, date, state);
}

export function removeRoomMember(
  ctx: CommandContext, state: StoreState, userID: UserID, roomID: RoomID, date: Instant, confirmDeletion: boolean,
): void {
  schedulingFor(ctx, state, houseOfRoom(state, roomID)).removeMember(userID, roomID, date, state, { confirmDeletion });
  // O último participante que sai apaga o cômodo: trocas e avisos dele não podem ficar pendurados.
  pruneDanglingReferences(state);
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
