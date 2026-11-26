import type { HouseSnapshot, Room, RoomParticipation, TaskDefinition, TaskItem } from "@/lib/api/types";
import type { CycleProgress } from "@/lib/format/labels";
import { weekStart } from "@/lib/format/dates";

// Regras de apresentação portadas do app (GetMyTasksOverviewUseCase, GetHouseOverviewUseCase, MyTasksViewModel,
// TaskDefinition.isLinked). O servidor continua sendo a autoridade: aqui só se decide o que mostrar e quais
// botões aparecem; a `api` recusa o que não vale.

const WEEK_MS = 7 * 86_400_000;

export const isCompleted = (item: TaskItem): boolean => item.occurrence.status === "completed";

/** "Repetição do cômodo": recorrente, nem `afterCompletion` nem `selfAssigned`, e `followsRoom` (ou, em definição
 *  antiga, a periodicidade semanal igual à do cômodo). */
export function isLinked(definition: TaskDefinition, room: Room): boolean {
  if (definition.kind !== "recurring" || definition.assignmentPolicy === "afterCompletion" || definition.assignmentPolicy === "selfAssigned") return false;
  if (definition.roomID !== room.id) return false;
  if (definition.followsRoom !== null) return definition.followsRoom;
  const r = definition.recurrence;
  const weekly = r.kind === "weekly" ? r.periodicity : r.kind === "recurring" && r.frequency === "weekly" ? { executionsPerPeriod: 1, intervalWeeks: r.interval } : null;
  return weekly !== null && weekly.intervalWeeks === room.periodicity.intervalWeeks && weekly.executionsPerPeriod === room.periodicity.executionsPerPeriod;
}

/** Abertas primeiro, depois concluídas; cada grupo por prazo, nome e ID. */
export function openFirst<T>(elements: readonly T[], item: (element: T) => TaskItem): T[] {
  const sorted = [...elements].sort((l, r) => {
    const a = item(l);
    const b = item(r);
    const dueA = a.occurrence.dueAt ?? Number.POSITIVE_INFINITY;
    const dueB = b.occurrence.dueAt ?? Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    if (a.definition.name !== b.definition.name) return a.definition.name < b.definition.name ? -1 : 1;
    return a.occurrence.id < b.occurrence.id ? -1 : a.occurrence.id > b.occurrence.id ? 1 : 0;
  });
  return [...sorted.filter((e) => !isCompleted(item(e))), ...sorted.filter((e) => isCompleted(item(e)))];
}

export interface RoomTask { readonly room: Room; readonly item: TaskItem }
export interface CycleGroup { readonly room: Room; readonly periodEnd: number; readonly progress: CycleProgress; readonly tasks: readonly TaskItem[] }
export interface MyTasksOverview { readonly cycleGroups: readonly CycleGroup[]; readonly extraTasks: readonly RoomTask[]; readonly sporadicTasks: readonly RoomTask[] }

/** Progresso do cômodo inteiro no ciclo (não só das tarefas do morador). */
export function cycleProgress(snapshot: HouseSnapshot, participation: RoomParticipation): CycleProgress {
  const tasks = cycleTasks(snapshot, participation);
  return { completed: tasks.filter(isCompleted).length, total: tasks.length };
}

export function cycleTasks(snapshot: HouseSnapshot, participation: RoomParticipation): TaskItem[] {
  const { room } = participation;
  return snapshot.roomTasks.filter((item) => isLinked(item.definition, room)
    && item.occurrence.availableAt >= participation.periodStart && item.occurrence.availableAt < participation.periodEnd);
}

export function myTasksOverview(snapshot: HouseSnapshot, now: number): MyTasksOverview {
  const timeZone = snapshot.home.house.timezone;
  const rooms = new Map(snapshot.home.rooms.map((room) => [room.id, room]));
  const participations = new Map(snapshot.participations.map((p) => [p.room.id, p]));
  const start = weekStart(now, timeZone);
  const isRecent = (item: TaskItem): boolean => item.occurrence.completedAt !== null && item.occurrence.completedAt >= start && item.occurrence.completedAt < start + WEEK_MS;

  const linkedByRoom = new Map<string, TaskItem[]>();
  const extras: RoomTask[] = [];
  const sporadics: RoomTask[] = [];
  for (const item of snapshot.myTasks) {
    const room = rooms.get(item.definition.roomID);
    if (room === undefined) continue;
    if (item.definition.kind === "sporadic") {
      if (!isCompleted(item) || isRecent(item)) sporadics.push({ room, item });
    } else if (isLinked(item.definition, room)) {
      linkedByRoom.set(room.id, [...(linkedByRoom.get(room.id) ?? []), item]);
    } else if (!isCompleted(item) || isRecent(item)) {
      extras.push({ room, item });
    }
  }

  const groups: CycleGroup[] = [];
  for (const [roomID, linked] of linkedByRoom) {
    const room = rooms.get(roomID);
    const participation = participations.get(roomID);
    if (room === undefined || participation === undefined) continue;
    const inCycle = linked.filter((item) => {
      const at = item.occurrence.availableAt;
      return (at >= participation.periodStart && at < participation.periodEnd) || (!isCompleted(item) && at < participation.periodStart);
    });
    if (inCycle.length === 0) continue;
    groups.push({ room, periodEnd: participation.periodEnd, progress: cycleProgress(snapshot, participation), tasks: openFirst(inCycle, (i) => i) });
  }
  groups.sort((a, b) => a.periodEnd - b.periodEnd || (a.room.name < b.room.name ? -1 : a.room.name > b.room.name ? 1 : a.room.id < b.room.id ? -1 : 1));
  return { cycleGroups: groups, extraTasks: openFirst(extras, (e) => e.item), sporadicTasks: openFirst(sporadics, (e) => e.item) };
}

export function overviewIsEmpty(overview: MyTasksOverview): boolean {
  return overview.cycleGroups.length === 0 && overview.extraTasks.length === 0 && overview.sporadicTasks.length === 0;
}

export function pendingCount(overview: MyTasksOverview): number {
  return [...overview.cycleGroups.flatMap((g) => g.tasks), ...overview.extraTasks.map((e) => e.item), ...overview.sporadicTasks.map((e) => e.item)]
    .filter((item) => !isCompleted(item)).length;
}

export interface RoomOverview {
  readonly participation: RoomParticipation;
  readonly responsibleNames: readonly string[];
  readonly responsibleUserIDs: readonly string[];
  readonly progress: CycleProgress | null;
  readonly accessRequestPending: boolean;
}

/** Card do cômodo na Casa: quem está de fato com as tarefas do ciclo (trocas incluídas); sem tarefas, a fila. */
export function roomOverviews(snapshot: HouseSnapshot): RoomOverview[] {
  const pending = new Set(snapshot.pendingRoomAccessIDs);
  return snapshot.participations.map((participation) => {
    if (!participation.isMember) {
      return { participation, responsibleNames: participation.responsibleNames, responsibleUserIDs: [], progress: null, accessRequestPending: pending.has(participation.room.id) };
    }
    const tasks = cycleTasks(snapshot, participation);
    const assignees = new Map<string, string>();
    for (const item of tasks) if (item.definition.kind === "recurring" && item.assignee !== null) assignees.set(item.assignee.id, item.assignee.name);
    const sorted = [...assignees.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    return {
      participation,
      responsibleNames: sorted.length === 0 ? participation.responsibleNames : sorted.map(([, name]) => name),
      responsibleUserIDs: sorted.map(([id]) => id),
      progress: { completed: tasks.filter(isCompleted).length, total: tasks.length },
      accessRequestPending: false,
    };
  });
}

// MARK: quem pode o quê (espelho do app; a `api` confere de novo)

export const canComplete = (item: TaskItem, userID: string, now: number): boolean =>
  item.assignment?.userID === userID && item.occurrence.availableAt <= now;

export const canRequestSwap = (item: TaskItem, userID: string, now: number): boolean =>
  item.assignment !== null && item.assignment.endedAt === null && item.assignment.userID === userID && !isCompleted(item) && item.occurrence.availableAt <= now;

export const canEnd = (definition: TaskDefinition): boolean => definition.kind === "recurring" && definition.endedAt === null;

/** Editar: avulsa só quem criou; recorrente ativa, quem participa do cômodo. */
export function canEdit(definition: TaskDefinition, userID: string, isRoomMember: boolean): boolean {
  if (definition.kind === "sporadic") return definition.createdByUserID === userID;
  return definition.endedAt === null && isRoomMember;
}

/** Pegar avulsa: participa do cômodo, sem responsável, não concluída. */
export const canClaim = (item: TaskItem, isRoomMember: boolean): boolean => isRoomMember && item.assignment === null && !isCompleted(item);

/** Gerenciar avulsa (editar/apagar/devolver na sheet): está com o morador e aberta. */
export const holdsSporadic = (item: TaskItem, userID: string): boolean => item.assignment?.userID === userID && !isCompleted(item);

export const isWholeHouse = (room: Room): boolean => room.kind === "wholeHouse";

export const ROOM_NAME_MAX = 30;

/** Nome de cômodo: obrigatório, até 30 caracteres, sem repetir (sem diferenciar maiúsculas). */
export function roomNameProblem(name: string, existing: readonly string[], current?: string): "empty" | "tooLong" | "duplicate" | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (trimmed.length > ROOM_NAME_MAX) return "tooLong";
  const lower = trimmed.toLocaleLowerCase();
  if (existing.some((n) => n.trim().toLocaleLowerCase() === lower && n !== current)) return "duplicate";
  return null;
}

/** Código de convite: 6 letras ou números, em maiúsculas. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
