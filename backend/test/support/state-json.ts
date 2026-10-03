import { DISTANT_FUTURE, DISTANT_PAST, formatInstant, parseInstant, type Instant } from "../../src/domain/dates.ts";
import type { SchedulingState } from "../../src/domain/entities.ts";

// Campos que carregam instantes nas fixtures (texto ISO-8601, ou "distantPast"/"distantFuture").
const INSTANT_KEYS = new Set([
  "availableAt", "dueAt", "completedAt", "assignedAt", "endedAt", "supersededAt", "calendarAnchor", "nextScheduledAt",
  "effectiveAt", "leftAt", "startsAt", "endsAt", "at", "boundary", "createdAt", "readAt", "resolvedAt",
]);

export function toInstant(text: string): Instant {
  if (text === "distantPast") return DISTANT_PAST;
  if (text === "distantFuture") return DISTANT_FUTURE;
  return parseInstant(text);
}

export function fromInstant(instant: Instant): string {
  if (instant === DISTANT_PAST) return "distantPast";
  if (instant === DISTANT_FUTURE) return "distantFuture";
  return formatInstant(instant).replace(".000Z", "Z");
}

function mapDeep(value: unknown, convert: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => mapDeep(item, convert));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = convert(key, mapDeep(item, convert));
    return result;
  }
  return value;
}

/** Texto ISO → `Instant` nos campos conhecidos. */
export function reviveInstants(value: unknown): unknown {
  return mapDeep(value, (key, item) => (INSTANT_KEYS.has(key) && typeof item === "string" ? toInstant(item) : item));
}

/** `Instant` → texto ISO nos campos conhecidos (formato das fixtures). */
export function stringifyInstants(value: unknown): unknown {
  return mapDeep(value, (key, item) => (INSTANT_KEYS.has(key) && typeof item === "number" ? fromInstant(item) : item));
}

export function decodeState(json: unknown): SchedulingState {
  return reviveInstants(json) as SchedulingState;
}

export function encodeState(state: SchedulingState): unknown {
  return stringifyInstants(state);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const WHOLE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function knownIDs(input: unknown): Set<string> {
  return new Set((JSON.stringify(input).match(UUID) ?? []).map((id) => id.toLowerCase()));
}

/** IDs gerados durante a execução (não presentes na entrada) viram `new-1`, `new-2`… por ordem de aparição. */
export function normalizeNewIDs(value: unknown, known: ReadonlySet<string>, map: Map<string, string> = new Map()): unknown {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (!WHOLE_UUID.test(lower) || known.has(lower)) return value;
    let mapped = map.get(lower);
    if (mapped === undefined) {
      mapped = `new-${map.size + 1}`;
      map.set(lower, mapped);
    }
    return mapped;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => normalizeNewIDs(item, known, map));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = normalizeNewIDs((value as Record<string, unknown>)[key], known, map);
    }
    return result;
  }
  return value;
}

/** IDs sequenciais e válidos como UUID, que nunca colidem com os das fixtures. */
export function sequentialIDs(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `ffffffff-ffff-4fff-8fff-${counter.toString(16).padStart(12, "0")}`;
  };
}
