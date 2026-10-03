import assert from "node:assert/strict";
import { test } from "node:test";
import { HungarianAlgorithm, scheduleCost, type ScheduleCost } from "../src/domain/services/hungarian.ts";
import { decodeNumber, loadFixture, outcome, type Outcome } from "./support/fixtures.ts";

type Raw = readonly (number | string)[];
type RawCost = { effort: number | string; difficulty: number | string; debt: number | string; changes: number | string };
type Case =
  | { name: string; kind: "scalar"; matrix: Raw[]; output: Outcome<number[]> }
  | { name: string; kind: "lexicographic"; costs: RawCost[][]; output: Outcome<number[]> };

const solver = new HungarianAlgorithm();

for (const c of loadFixture<Case>("hungarian").cases) {
  test(`Húngaro (Swift): ${c.kind} ${c.name}`, () => {
    const actual = c.kind === "scalar"
      ? outcome(() => solver.solve(c.matrix.map((row) => row.map(decodeNumber))))
      : outcome(() =>
        solver.solveLexicographic(c.costs.map((row) =>
          row.map((x): ScheduleCost =>
            scheduleCost({
              effort: decodeNumber(x.effort), difficulty: decodeNumber(x.difficulty),
              debt: decodeNumber(x.debt), changes: decodeNumber(x.changes),
            })
          )
        ))
      );
    assert.deepStrictEqual(actual, c.output);
  });
}
