import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar } from "../src/domain/dates.ts";
import type { TaskAssignment, TaskOccurrence } from "../src/domain/entities.ts";
import { userID } from "../src/domain/ids.ts";
import { FairnessCalculator } from "../src/domain/services/fairness.ts";
import { RotationCalculator } from "../src/domain/services/rotation.ts";
import { WeeklyLoadCalculator } from "../src/domain/services/weekly-load.ts";
import { loadFixture, normalizeZero, outcome, type Outcome } from "./support/fixtures.ts";
import { reviveInstants, toInstant } from "./support/state-json.ts";

interface FairnessCase { effort: number; executor: string; eligible: string[]; output: Outcome<Record<string, number>> }
for (const [i, c] of loadFixture<FairnessCase>("fairness").cases.entries()) {
  test(`saldo de justiça (Swift) #${i}`, () => {
    const actual = outcome(() => new FairnessCalculator().calculateDebtImpact(c.effort, userID(c.executor), c.eligible.map(userID)));
    assert.deepStrictEqual(normalizeZero(actual), normalizeZero(c.output));
  });
}

interface LoadCase {
  zone: string; userID: string; referenceDate: string; occurrences: unknown[]; assignments: unknown[]; output: number;
}
for (const [i, c] of loadFixture<LoadCase>("weekly-load").cases.entries()) {
  test(`carga semanal (Swift) #${i} ${c.zone}`, () => {
    const actual = new WeeklyLoadCalculator().calculate(
      userID(c.userID), reviveInstants(c.assignments) as TaskAssignment[], reviveInstants(c.occurrences) as TaskOccurrence[],
      toInstant(c.referenceDate), createCalendar(c.zone),
    );
    assert.equal(actual, c.output);
  });
}

type RotationCase =
  | { op: "advance"; index: number; queue: string[]; output: Outcome<number> }
  | { op: "nextUser"; current: string | null; eligible: string[]; output: string | null };
for (const [i, c] of loadFixture<RotationCase>("rotation").cases.entries()) {
  test(`rotação (Swift) #${i} ${c.op}`, () => {
    const rotation = new RotationCalculator();
    if (c.op === "advance") {
      assert.deepStrictEqual(outcome(() => rotation.advance(c.index, c.queue.map(userID))), c.output);
    } else {
      assert.equal(rotation.nextUser(c.current === null ? null : userID(c.current), c.eligible.map(userID)), c.output);
    }
  });
}
