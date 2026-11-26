import type { Room, TaskItem, User } from "@/lib/api/types";
import { weekStart } from "@/lib/format/dates";
import { isLinked } from "@/lib/rules/tasks";

// Agrupamento da tela do cômodo (RoomDetailSections/RoomTaskFilter do app): só filtra e agrupa, a escala é do servidor.

export type RoomTaskFilter = "now" | "all";

const WEEK_MS = 7 * 86_400_000;

/** "Agora": o que já abriu e o que abre ainda nesta semana (segunda a domingo no fuso da casa). "Todas": tudo. */
export function includes(filter: RoomTaskFilter, availableAt: number, now: number, timeZone: string): boolean {
  if (filter === "all" || availableAt <= now) return true;
  return availableAt < weekStart(now, timeZone) + WEEK_MS;
}

export interface RoomSections {
  readonly cycle: readonly TaskItem[];
  readonly general: readonly TaskItem[];
  readonly single: readonly TaskItem[];
}

export function roomSections(room: Room, tasks: readonly TaskItem[], sporadic: readonly TaskItem[], filter: RoomTaskFilter, now: number, timeZone: string): RoomSections {
  const visible = tasks.filter((item) => includes(filter, item.occurrence.availableAt, now, timeZone));
  return {
    cycle: visible.filter((item) => item.definition.kind === "recurring" && isLinked(item.definition, room)),
    general: visible.filter((item) => item.definition.kind === "recurring" && !isLinked(item.definition, room)),
    single: sporadic.filter((item) => item.definition.roomID === room.id && includes(filter, item.occurrence.availableAt, now, timeZone)),
  };
}

export const sectionsEmpty = (sections: RoomSections): boolean =>
  sections.cycle.length === 0 && sections.general.length === 0 && sections.single.length === 0;

/** Quem está com alguma tarefa do ciclo, sem repetir, em ordem pelo ID (minúsculo). */
export function cycleAssignees(room: Room, tasks: readonly TaskItem[]): User[] {
  const byID = new Map<string, User>();
  for (const item of tasks) {
    if (item.definition.kind !== "recurring" || !isLinked(item.definition, room) || item.assignee === null) continue;
    const id = item.assignee.id.toLowerCase();
    if (!byID.has(id)) byID.set(id, item.assignee);
  }
  return [...byID.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, user]) => user);
}
