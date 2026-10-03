import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCalendar, formatInstant, parseInstant } from "../src/domain/dates.ts";
import { DomainError, isDomainError } from "../src/domain/errors.ts";

// Referência: Foundation (via fixtures geradas do Swift). Ver o cabeçalho `_generated` do JSON.
interface OracleCase {
  zone: string;
  instant: string;
  ops: Record<string, string | number | { error: string }>;
}
const fixture: { cases: OracleCase[] } = JSON.parse(
  readFileSync(new URL("./fixtures/dates-oracle.json", import.meta.url), "utf8"),
);

function run(fn: () => string | number): string | number | { error: string } {
  try {
    return fn();
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    throw error;
  }
}

test("calendário concorda com o Foundation em todas as operações e fusos", () => {
  const mismatches: string[] = [];
  let checked = 0;
  for (const c of fixture.cases) {
    const cal = createCalendar(c.zone);
    const t = parseInstant(c.instant);
    const iso = (fn: () => number) => () => formatInstant(fn()).replace(".000Z", "Z");
    const actual: Record<string, string | number | { error: string }> = {
      weekStart: run(iso(() => cal.weekStart(t))),
      startOfDay: run(iso(() => cal.startOfDay(t))),
    };
    for (const n of [1, 2, 7, 30, 365]) actual[`addDays${n}`] = run(iso(() => cal.addDays(t, n)));
    for (const n of [1, 12, 20]) actual[`addWeeks${n}`] = run(iso(() => cal.addWeeks(t, n)));
    for (const n of [1, 2, 12]) actual[`addMonths${n}`] = run(iso(() => cal.addMonths(t, n)));
    actual["addYears1"] = run(iso(() => cal.addYears(t, 1)));
    for (const k of [0, 1, 6, 7, 40, 200]) {
      actual[`daysBetween${k}`] = run(() => cal.daysBetween(cal.weekStart(t), cal.startOfDay(cal.addDays(t, k))));
    }
    for (const k of [0, 3, 11, 12, 13]) {
      actual[`weekIndex${k}`] = run(() => {
        const week = cal.weeksBetween(cal.weekStart(t), cal.weekStart(cal.addWeeks(t, k)));
        if (week < 0 || week >= 12) throw new DomainError("invalidDateInterval");
        return week;
      });
    }
    for (const [name, expected] of Object.entries(c.ops)) {
      checked += 1;
      const got = actual[name];
      if (JSON.stringify(got) !== JSON.stringify(expected)) mismatches.push(`${c.zone} ${c.instant} ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(expected)}`);
    }
  }
  assert.ok(checked > 5_000, `esperava muitas verificações, rodou ${checked}`);
  assert.deepEqual(mismatches.slice(0, 20), []);
});
