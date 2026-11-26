import type { AssignmentPolicy, Periodicity, Recurrence, Room, TaskDefinition, TaskKind } from "@/lib/api/types";
import type { TaskChanges, TaskInput } from "@/lib/client/endpoints";
import { isLinked, isWholeHouse } from "@/lib/rules/tasks";

// Rascunho do editor de tarefa (TaskDraft + TaskEditorViewModel do app). Ao editar, o cômodo e o tipo (única ou
// recorrente) não mudam; nome, descrição, esforço, o intervalo da repetição própria e "Repetir com o cômodo" sim.

export interface TaskDraft {
  readonly name: string;
  readonly details: string;
  readonly roomID: string | null;
  readonly effort: number;
  readonly kind: TaskKind;
  readonly recurrence: Recurrence;
  readonly assignmentPolicy: AssignmentPolicy;
  /** "Repetir com o cômodo": a repetição acompanha a periodicidade do cômodo e a tarefa entra no ciclo dele. */
  readonly followsRoom: boolean;
}

export interface DraftContext {
  /** Cômodos de que o morador participa (os únicos em que pode criar). */
  readonly rooms: readonly Room[];
  readonly isEditing: boolean;
}

const WEEKLY: Recurrence = { kind: "recurring", frequency: "weekly", interval: 1 };
const NONE: Recurrence = { kind: "none" };

export function weeklyPeriodicity(recurrence: Recurrence): Periodicity | null {
  if (recurrence.kind === "weekly") return recurrence.periodicity;
  if (recurrence.kind === "recurring" && recurrence.frequency === "weekly") return { executionsPerPeriod: 1, intervalWeeks: recurrence.interval };
  return null;
}

export function sameRecurrence(a: Recurrence, b: Recurrence): boolean {
  if (a.kind === "none" || b.kind === "none") return a.kind === b.kind;
  if (a.kind === "weekly" && b.kind === "weekly") {
    return a.periodicity.executionsPerPeriod === b.periodicity.executionsPerPeriod && a.periodicity.intervalWeeks === b.periodicity.intervalWeeks;
  }
  if (a.kind === "recurring" && b.kind === "recurring") return a.frequency === b.frequency && a.interval === b.interval;
  return false;
}

export function sameDraft(a: TaskDraft, b: TaskDraft): boolean {
  return a.name === b.name && a.details === b.details && a.roomID === b.roomID && a.effort === b.effort && a.kind === b.kind
    && sameRecurrence(a.recurrence, b.recurrence) && a.assignmentPolicy === b.assignmentPolicy && a.followsRoom === b.followsRoom;
}

const roomOf = (draft: TaskDraft, ctx: DraftContext): Room | undefined => ctx.rooms.find((room) => room.id === draft.roomID);

/** A repetição é a mesma do cômodo escolhido (e por isso não serve como repetição própria). */
export function isRoomPeriodicity(recurrence: Recurrence, room: Room | undefined): boolean {
  if (room === undefined) return false;
  const weekly = weeklyPeriodicity(recurrence);
  return weekly !== null && weekly.executionsPerPeriod === room.periodicity.executionsPerPeriod && weekly.intervalWeeks === room.periodicity.intervalWeeks;
}

/** Com "Repetir com o cômodo", a repetição é sempre a periodicidade do cômodo escolhido. */
function syncWithRoom(draft: TaskDraft, ctx: DraftContext): TaskDraft {
  const room = roomOf(draft, ctx);
  if (draft.kind !== "recurring" || !draft.followsRoom || room === undefined) return draft;
  return { ...draft, recurrence: { kind: "weekly", periodicity: room.periodicity } };
}

/** Tarefa única sem cômodo escolhido cai em "Casa toda". */
function applyDefaultRoom(draft: TaskDraft, ctx: DraftContext): TaskDraft {
  if (draft.kind !== "sporadic" || draft.roomID !== null) return draft;
  const whole = ctx.rooms.find(isWholeHouse);
  return whole === undefined ? draft : { ...draft, roomID: whole.id };
}

export function newDraft(ctx: DraftContext, roomID: string | null): TaskDraft {
  const draft: TaskDraft = {
    name: "", details: "", roomID: ctx.rooms.some((room) => room.id === roomID) ? roomID : null, effort: 1,
    kind: "recurring", recurrence: WEEKLY, assignmentPolicy: "balancedAutomatically", followsRoom: true,
  };
  return syncWithRoom(draft, ctx);
}

export function editDraft(definition: TaskDefinition, ctx: DraftContext): TaskDraft {
  const room = ctx.rooms.find((r) => r.id === definition.roomID);
  const followsRoom = definition.followsRoom
    ?? (room !== undefined ? isLinked(definition, room) : definition.kind === "recurring" && definition.assignmentPolicy !== "afterCompletion");
  const draft: TaskDraft = {
    name: definition.name, details: definition.details, roomID: definition.roomID, effort: definition.effort,
    kind: definition.kind, recurrence: definition.recurrence, assignmentPolicy: definition.assignmentPolicy, followsRoom,
  };
  return draft.followsRoom ? syncWithRoom(draft, ctx) : draft;
}

/** Aplica uma mudança do formulário com as mesmas consequências do app (tipo, política e repetição andam juntos). */
export function applyChange(previous: TaskDraft, changed: TaskDraft, ctx: DraftContext): TaskDraft {
  let draft = changed;
  if (draft.kind !== previous.kind) {
    draft = {
      ...draft,
      recurrence: draft.kind === "sporadic" ? NONE : WEEKLY,
      assignmentPolicy: draft.kind === "sporadic" ? "selfAssigned" : "balancedAutomatically",
    };
  } else if (draft.assignmentPolicy !== previous.assignmentPolicy) {
    switch (draft.assignmentPolicy) {
      case "selfAssigned": draft = { ...draft, kind: "sporadic", recurrence: NONE }; break;
      case "afterCompletion": draft = { ...draft, kind: "recurring", recurrence: NONE }; break;
      default: draft = { ...draft, kind: "recurring", recurrence: draft.recurrence.kind === "none" ? WEEKLY : draft.recurrence };
    }
  } else if (!sameRecurrence(draft.recurrence, previous.recurrence)) {
    const kind: TaskKind = draft.recurrence.kind === "none" ? "sporadic" : "recurring";
    draft = { ...draft, kind, assignmentPolicy: kind === "sporadic" ? "selfAssigned" : "balancedAutomatically" };
  }
  draft = syncWithRoom(draft, ctx);
  if (!ctx.isEditing && draft.kind !== previous.kind) draft = applyDefaultRoom(draft, ctx);
  return draft;
}

const OWN_CANDIDATES: readonly Recurrence[] = [
  { kind: "recurring", frequency: "weekly", interval: 2 },
  { kind: "recurring", frequency: "monthly", interval: 1 },
  WEEKLY,
];

/** Desligar "Repetir com o cômodo" dá à tarefa uma repetição própria diferente da do cômodo. */
export function setFollowsRoom(draft: TaskDraft, followsRoom: boolean, ctx: DraftContext): TaskDraft {
  const room = roomOf(draft, ctx);
  const recurrence = followsRoom ? draft.recurrence : (OWN_CANDIDATES.find((r) => !isRoomPeriodicity(r, room)) ?? draft.recurrence);
  return applyChange(draft, { ...draft, followsRoom, recurrence }, ctx);
}

export function selectRecurrence(draft: TaskDraft, recurrence: Recurrence, ctx: DraftContext): TaskDraft {
  return applyChange(draft, { ...draft, followsRoom: false, recurrence }, ctx);
}

export function canSave(draft: TaskDraft, initial: TaskDraft, isEditing: boolean): boolean {
  const hasTitle = draft.name.trim() !== "";
  if (!isEditing) return hasTitle && draft.roomID !== null;
  return hasTitle && !sameDraft(draft, initial);
}

/** Corpo do `POST`: repetição própria é a política "por conclusão" com o intervalo escolhido. */
export function createInput(draft: TaskDraft): TaskInput {
  const own = draft.kind === "recurring" && !draft.followsRoom;
  const policy: AssignmentPolicy = own && (draft.assignmentPolicy === "balancedAutomatically" || draft.assignmentPolicy === "calendarRotation")
    ? "afterCompletion" : draft.assignmentPolicy;
  return {
    name: draft.name.trim(), details: draft.details.trim(), effort: draft.effort, kind: draft.kind,
    recurrence: draft.recurrence, assignmentPolicy: policy,
    ...(draft.kind === "recurring" ? { followsRoom: draft.followsRoom } : {}),
  };
}

/** Corpo do `PATCH`: só o que mudou (esforço e repetição só quando mudam). */
export function editChanges(definition: TaskDefinition, initial: TaskDraft, draft: TaskDraft): TaskChanges {
  const canEditRecurrence = definition.kind === "recurring";
  const switching = canEditRecurrence && draft.followsRoom !== initial.followsRoom;
  const sendRecurrence = canEditRecurrence && !draft.followsRoom && (switching || !sameRecurrence(draft.recurrence, definition.recurrence));
  return {
    name: draft.name.trim(),
    details: draft.details.trim(),
    ...(draft.effort !== definition.effort ? { effort: draft.effort } : {}),
    ...(sendRecurrence ? { recurrence: draft.recurrence } : {}),
    ...(switching ? { followsRoom: draft.followsRoom } : {}),
  };
}

/** O modo de repetição mudou em relação à tarefa aberta (a vez atual recomeça ao salvar). */
export function changesRepetitionMode(definition: TaskDefinition | undefined, initial: TaskDraft, draft: TaskDraft): boolean {
  return definition !== undefined && definition.kind === "recurring" && draft.followsRoom !== initial.followsRoom;
}
