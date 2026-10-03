import assert from "node:assert/strict";
import { test } from "node:test";
import { userID } from "../src/domain/ids.ts";
import { TaskDistributionEngine } from "../src/domain/services/task-distribution-engine.ts";
import { decodeDebts, decodeGrid, loadFixture, outcome, type Outcome, type WeekTuple } from "./support/fixtures.ts";

interface Case {
  name: string;
  input: {
    effort: number; participants: string[]; weeks: number[];
    projection: Record<string, WeekTuple[]>; debts: Record<string, number | string>;
  };
  output: Outcome<string[]>;
}

const engine = new TaskDistributionEngine();

for (const c of loadFixture<Case>("distribution-engine").cases) {
  test(`motor de distribuição (Swift): ${c.name}`, () => {
    const { input } = c;
    const actual = outcome(() =>
      engine.generateInitialQueue(
        input.effort, input.participants.map(userID), input.weeks, decodeGrid(input.projection), decodeDebts(input.debts),
      )
    );
    assert.deepStrictEqual(actual, c.output);
  });
}
