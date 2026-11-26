import type { HouseSnapshot, TaskItem, User } from "@/lib/api/types";
import { isCompleted } from "@/lib/rules/tasks";

// Detalhe da tarefa (GetTaskOverviewUseCase + GetTaskUpcomingAssignmentsUseCase): tudo sai das ocorrências que o
// snapshot já tem, como no app.

export interface Upcoming {
  readonly occurrenceID: string;
  readonly assignee: User | null;
  readonly availableAt: number;
  readonly isCurrent: boolean;
}

export interface TaskOverview {
  readonly current: TaskItem | null;
  readonly lastCompleted: TaskItem | null;
  readonly upcoming: readonly Upcoming[];
}

const byAvailableThenID = (a: TaskItem, b: TaskItem): number =>
  a.occurrence.availableAt - b.occurrence.availableAt || (a.occurrence.id.toLowerCase() < b.occurrence.id.toLowerCase() ? -1 : a.occurrence.id.toLowerCase() > b.occurrence.id.toLowerCase() ? 1 : 0);

/** Ocorrências da definição no snapshot (sem repetir a mesma ocorrência entre as listas). */
export function itemsOf(snapshot: HouseSnapshot, definitionID: string): TaskItem[] {
  const id = definitionID.toLowerCase();
  const seen = new Map<string, TaskItem>();
  for (const item of [...snapshot.roomTasks, ...snapshot.sporadicTasks, ...snapshot.myTasks]) {
    if (item.definition.id.toLowerCase() === id && !seen.has(item.occurrence.id)) seen.set(item.occurrence.id, item);
  }
  return [...seen.values()];
}

export function overview(items: readonly TaskItem[], userID: string, now: number): TaskOverview {
  // Em repetição própria cada morador tem a sua vez aberta: a "atual" é a de quem pergunta; sem ela, a mais antiga.
  const open = items.filter((item) => !isCompleted(item) && item.occurrence.availableAt <= now);
  const mine = open.filter((item) => item.assignment?.userID === userID && item.assignment.endedAt === null);
  const current = [...(mine.length === 0 ? open : mine)].sort(byAvailableThenID)[0] ?? null;

  const completed = items.filter(isCompleted);
  const lastCompleted = completed.reduce<TaskItem | null>((best, item) => {
    if (best === null) return item;
    const left = best.occurrence.completedAt ?? best.occurrence.availableAt;
    const right = item.occurrence.completedAt ?? item.occurrence.availableAt;
    if (right !== left) return right > left ? item : best;
    return item.occurrence.id.toLowerCase() < best.occurrence.id.toLowerCase() ? item : best;
  }, null);

  return { current, lastCompleted, upcoming: upcomingQueue(items, now) };
}

/** Fila de quem faz: uma volta só, a mesma pessoa nunca duas vezes seguidas. */
export function upcomingQueue(items: readonly TaskItem[], now: number): Upcoming[] {
  const sorted = items.filter((item) => !isCompleted(item)).sort(byAvailableThenID).map((item): Upcoming => ({
    occurrenceID: item.occurrence.id, assignee: item.assignee, availableAt: item.occurrence.availableAt, isCurrent: item.occurrence.availableAt <= now,
  }));
  const collapsed: Upcoming[] = [];
  for (const entry of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (entry.assignee !== null && last !== undefined && last.assignee?.id === entry.assignee.id) {
      collapsed[collapsed.length - 1] = { ...last, isCurrent: last.isCurrent || entry.isCurrent };
    } else {
      collapsed.push(entry);
    }
  }
  const anchor = collapsed.find((entry) => entry.assignee !== null)?.assignee?.id;
  if (anchor === undefined) return collapsed;
  const lap: Upcoming[] = [];
  let sawOther = false;
  for (const entry of collapsed) {
    const id = entry.assignee?.id;
    if (id !== undefined) {
      if (id !== anchor) sawOther = true;
      else if (sawOther) break;
    }
    lap.push(entry);
  }
  return lap;
}

export type QueuePosition = "current" | "next" | "later";

/** "Atual" para quem está com a vez, "Próximo" para o seguinte; os demais mostram a data. */
export function queuePosition(queue: readonly Upcoming[], index: number): QueuePosition {
  if (queue[index]?.isCurrent === true) return "current";
  const hasCurrent = queue[0]?.isCurrent === true;
  return index === (hasCurrent ? 1 : 0) ? "next" : "later";
}
