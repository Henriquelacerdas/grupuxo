import type { TaskOccurrenceID, UserID } from "../domain/ids.ts";
import { taskOccurrenceID, userID } from "../domain/ids.ts";
import type { RatingInput } from "../domain/commands/ratings.ts";
import type { RoomPatch } from "../domain/commands/rooms.ts";
import { RATING_LEVELS, RATING_TAGS, type RoomRatingTag } from "../domain/entities.ts";
import type { TaskRange } from "../domain/use-cases/tasks.ts";
import type { NewTaskInput, TaskDetailsInput } from "../domain/use-cases/tasks.ts";
import {
  ASSIGNMENT_POLICIES, RECURRENCE_FREQUENCIES, ROOM_CATEGORIES, ROOM_COLORS, ROOM_VISIBILITIES, TASK_KINDS,
  weeklyPeriodicity, weeklyRecurrence, NO_RECURRENCE, recurring,
  type RecurrencePolicy, type RoomCategory, type RoomColor, type RoomVisibility, type WeeklyPeriodicity,
} from "../domain/value-objects.ts";
import { field, isRecord, type Fields } from "./events.ts";

// Estreitamento da entrada das rotas (de `unknown`, sem `as`). Corpo com campo de tipo errado → `null` (o handler
// responde `400 bad_request`); campo opcional ausente fica ausente. Regras de negócio (nome em branco, periodicidade
// inválida...) são do domínio, não daqui.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (values.find((candidate) => candidate === value) ?? null) : null;
}

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

export function parseCreateHouse(body: Fields): { readonly name: string; readonly timezone: string } | null {
  const name = field(body, "name");
  const timezone = field(body, "timezone");
  return typeof name === "string" && typeof timezone === "string" ? { name, timezone } : null;
}

/** `{ "name" }` de `PATCH /me` e de `PATCH /houses/{houseID}`; a regra do nome é do domínio / do diretório. */
export function parseRename(body: Fields): { readonly name: string } | null {
  const name = field(body, "name");
  return typeof name === "string" ? { name } : null;
}

export function parseJoinHouse(body: Fields): { readonly code: string } | null {
  const code = field(body, "code");
  return typeof code === "string" ? { code } : null;
}

/** `{ "userID" }` de `POST /rooms/{roomID}/members`. */
export function parseRoomMember(body: Fields): UserID | null {
  const value = field(body, "userID");
  return typeof value === "string" && UUID.test(value) ? userID(value) : null;
}

/** `{ "offeredOccurrenceID", "requestedOccurrenceID" }` de `POST /swaps`. */
export function parseCreateSwap(
  body: Fields,
): { readonly offered: TaskOccurrenceID; readonly requested: TaskOccurrenceID } | null {
  const offered = field(body, "offeredOccurrenceID");
  const requested = field(body, "requestedOccurrenceID");
  return typeof offered === "string" && UUID.test(offered) && typeof requested === "string" && UUID.test(requested)
    ? { offered: taskOccurrenceID(offered), requested: taskOccurrenceID(requested) }
    : null;
}

function parsePeriodicity(value: unknown): WeeklyPeriodicity | null {
  if (!isRecord(value)) return null;
  const executions = field(value, "executionsPerPeriod");
  const interval = field(value, "intervalWeeks");
  return isInteger(executions) && isInteger(interval) ? weeklyPeriodicity(executions, interval) : null;
}

export interface ParsedRoom {
  readonly name: string;
  readonly visibility: RoomVisibility;
  readonly category?: RoomCategory;
  readonly periodicity?: WeeklyPeriodicity;
  readonly responsibleCount?: number;
  readonly icon?: string;
  readonly color?: RoomColor;
  /** `null` = ausente; `"invalid"` = algum elemento não é UUID (o domínio responde `invalidRoomParticipants`). */
  readonly participantIDs: readonly UserID[] | "invalid" | null;
}

export function parseCreateRoom(body: Fields): ParsedRoom | null {
  const name = field(body, "name");
  const visibility = oneOf(ROOM_VISIBILITIES, field(body, "visibility"));
  if (typeof name !== "string" || visibility === null) return null;
  const parsed: { -readonly [K in keyof ParsedRoom]: ParsedRoom[K] } = { name, visibility, participantIDs: null };

  const category = field(body, "category");
  if (category !== undefined) {
    const value = oneOf(ROOM_CATEGORIES, category);
    if (value === null) return null;
    parsed.category = value;
  }
  const periodicity = field(body, "periodicity");
  if (periodicity !== undefined) {
    const value = parsePeriodicity(periodicity);
    if (value === null) return null;
    parsed.periodicity = value;
  }
  const responsibleCount = field(body, "responsibleCount");
  if (responsibleCount !== undefined) {
    if (!isInteger(responsibleCount)) return null;
    parsed.responsibleCount = responsibleCount;
  }
  const icon = field(body, "icon");
  if (icon !== undefined) {
    if (typeof icon !== "string") return null;
    parsed.icon = icon;
  }
  const color = field(body, "color");
  if (color !== undefined) {
    const value = oneOf(ROOM_COLORS, color);
    if (value === null) return null;
    parsed.color = value;
  }
  const participants = field(body, "participantIDs");
  if (participants !== undefined) {
    if (!Array.isArray(participants)) return null;
    const entries: readonly unknown[] = participants;
    const ids: UserID[] = [];
    for (const entry of entries) {
      if (typeof entry !== "string") return null;
      if (!UUID.test(entry)) {
        parsed.participantIDs = "invalid";
        return parsed;
      }
      ids.push(userID(entry));
    }
    parsed.participantIDs = ids;
  }
  return parsed;
}

/**
 * Corpo de `PATCH /rooms/{id}`: ao menos um campo; os ausentes não mudam. Campo de tipo errado ou corpo vazio → `null`.
 * Nome em branco e periodicidade inválida são do domínio.
 */
export function parseUpdateRoom(body: Fields): RoomPatch | null {
  const patch: { -readonly [K in keyof RoomPatch]: RoomPatch[K] } = {};
  const name = field(body, "name");
  if (name !== undefined) {
    if (typeof name !== "string") return null;
    patch.name = name;
  }
  const category = field(body, "category");
  if (category !== undefined) {
    const value = oneOf(ROOM_CATEGORIES, category);
    if (value === null) return null;
    patch.category = value;
  }
  const icon = field(body, "icon");
  if (icon !== undefined) {
    if (typeof icon !== "string") return null;
    patch.icon = icon;
  }
  const color = field(body, "color");
  if (color !== undefined) {
    const value = oneOf(ROOM_COLORS, color);
    if (value === null) return null;
    patch.color = value;
  }
  const periodicity = field(body, "periodicity");
  if (periodicity !== undefined) {
    const value = parsePeriodicity(periodicity);
    if (value === null) return null;
    patch.periodicity = value;
  }
  const responsibleCount = field(body, "responsibleCount");
  if (responsibleCount !== undefined) {
    if (!isInteger(responsibleCount)) return null;
    patch.responsibleCount = responsibleCount;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Corpo de `POST /rooms/{roomID}/ratings`: `{ periodStart: ISO, level, tags?: [tag] }`; fora do catálogo → `null`. */
export function parseRating(body: Fields): RatingInput | null {
  const periodStart = field(body, "periodStart");
  const level = oneOf(RATING_LEVELS, field(body, "level"));
  const tagsBody = field(body, "tags");
  if (typeof periodStart !== "string" || level === null) return null;
  const instant = Date.parse(periodStart);
  if (!Number.isFinite(instant)) return null;
  const tags: RoomRatingTag[] = [];
  if (tagsBody !== undefined) {
    if (!Array.isArray(tagsBody)) return null;
    const entries: readonly unknown[] = tagsBody;
    for (const entry of entries) {
      const tag = oneOf(RATING_TAGS, entry);
      if (tag === null) return null;
      tags.push(tag);
    }
  }
  return { periodStart: instant, level, tags };
}

function parseRecurrence(value: unknown): RecurrencePolicy | null {
  if (!isRecord(value)) return null;
  switch (field(value, "kind")) {
    case "none":
      return NO_RECURRENCE;
    case "recurring": {
      const frequency = oneOf(RECURRENCE_FREQUENCIES, field(value, "frequency"));
      const interval = field(value, "interval");
      return frequency !== null && isInteger(interval) ? recurring(frequency, interval) : null;
    }
    case "weekly": {
      const periodicity = parsePeriodicity(field(value, "periodicity"));
      return periodicity === null ? null : weeklyRecurrence(periodicity);
    }
    default:
      return null;
  }
}

/** Corpo de `POST /rooms/{roomID}/tasks`: todos os campos são obrigatórios (BACKEND.md, seção 6.1). */
export function parseCreateTask(body: Fields): Omit<NewTaskInput, "roomID"> | null {
  const name = field(body, "name");
  const details = field(body, "details");
  const effort = field(body, "effort");
  const kind = oneOf(TASK_KINDS, field(body, "kind"));
  const recurrence = parseRecurrence(field(body, "recurrence"));
  const assignmentPolicy = oneOf(ASSIGNMENT_POLICIES, field(body, "assignmentPolicy"));
  if (
    typeof name !== "string" || typeof details !== "string" || !isInteger(effort) || effort < 1 || effort > 3 ||
    kind === null || recurrence === null || assignmentPolicy === null
  ) {
    return null;
  }
  // Opcional: o app antigo não manda "Repetir com o cômodo"; de tipo errado → corpo inválido.
  const followsRoom = field(body, "followsRoom");
  if (followsRoom !== undefined && followsRoom !== null && typeof followsRoom !== "boolean") return null;
  return typeof followsRoom === "boolean"
    ? { name, details, effort, kind, recurrence, assignmentPolicy, followsRoom }
    : { name, details, effort, kind, recurrence, assignmentPolicy };
}

/** Corpo de `PATCH /rooms/{roomID}/tasks/{taskID}`: ao menos um entre `name`, `details`, `effort` (1 a 3) e `recurrence`; campo de tipo errado → `null`. */
export function parseUpdateTask(body: Fields): TaskDetailsInput | null {
  const name = field(body, "name");
  const details = field(body, "details");
  const effort = field(body, "effort");
  const recurrenceBody = field(body, "recurrence");
  const recurrence = recurrenceBody === undefined ? undefined : parseRecurrence(recurrenceBody);
  if (
    (name !== undefined && typeof name !== "string") || (details !== undefined && typeof details !== "string") ||
    (effort !== undefined && (!isInteger(effort) || effort < 1 || effort > 3)) || recurrence === null
  ) {
    return null;
  }
  if (name === undefined && details === undefined && effort === undefined && recurrence === undefined) return null;
  return {
    ...(name === undefined ? {} : { name }), ...(details === undefined ? {} : { details }),
    ...(effort === undefined ? {} : { effort }), ...(recurrence === undefined ? {} : { recurrence }),
  };
}

/** Parâmetro booleano da query: ausente ou `false` → `false`; `true` → `true`; outro valor → `null`. */
export function parseFlag(query: Readonly<Record<string, string>>, name: string): boolean | null {
  const value = Object.hasOwn(query, name) ? query[name] : undefined;
  if (value === undefined || value === "false") return false;
  return value === "true" ? true : null;
}

/** `range` de `GET /me/tasks`: ausente → `all`; só `week` e `all` valem. */
export function parseRange(query: Readonly<Record<string, string>>): TaskRange | null {
  const value = Object.hasOwn(query, "range") ? query["range"] : undefined;
  if (value === undefined) return "all";
  return value === "week" || value === "all" ? value : null;
}
