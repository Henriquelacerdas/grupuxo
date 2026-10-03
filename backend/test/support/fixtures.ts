import { readFileSync } from "node:fs";
import { parseInstant, type Instant } from "../../src/domain/dates.ts";
import { DomainError } from "../../src/domain/errors.ts";
import { userID, type UserID } from "../../src/domain/ids.ts";
import type { ProjectedWeek } from "../../src/domain/services/task-distribution-engine.ts";

/** Fixture gerada a partir do Swift (`tools/swift-fixtures`); o cabeçalho `_generated` diz como. */
export function loadFixture<T>(name: string): { cases: T[] } {
  const text = readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("cases" in parsed) || !Array.isArray(parsed.cases)) {
    throw new Error(`fixture ${name} sem "cases"`);
  }
  return parsed as { cases: T[] };
}

/** Número, ou texto para os valores que o JSON não representa. */
export function decodeNumber(value: number | string): number {
  switch (value) {
    case "NaN": return NaN;
    case "Infinity": return Infinity;
    case "-Infinity": return -Infinity;
    default:
      if (typeof value === "number") return value;
      throw new Error(`número inválido na fixture: ${value}`);
  }
}

export type WeekTuple = readonly [number | string, number | string, number | string, number | string];

export function decodeWeek(tuple: WeekTuple): ProjectedWeek {
  return { load: decodeNumber(tuple[0]), level1: decodeNumber(tuple[1]), level2: decodeNumber(tuple[2]), level3: decodeNumber(tuple[3]) };
}

export function decodeGrid(record: Record<string, WeekTuple[]>): Map<UserID, ProjectedWeek[]> {
  return new Map(Object.entries(record).map(([id, weeks]) => [userID(id), weeks.map(decodeWeek)]));
}

export function decodeDebts(record: Record<string, number | string>): Map<UserID, number> {
  return new Map(Object.entries(record).map(([id, value]) => [userID(id), decodeNumber(value)]));
}

export type Outcome<T> = T | { error: string };

/** Executa e devolve o resultado ou `{ error: código }`, como nas fixtures. */
export function outcome<T>(run: () => T): Outcome<T> {
  try {
    return run();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
}

/** `-0` e `0` são o mesmo número aqui; o `deepStrictEqual` os distingue. */
export function normalizeZero<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (v === 0 ? 0 : v))) as T;
}

export function instant(text: string): Instant {
  return parseInstant(text);
}
