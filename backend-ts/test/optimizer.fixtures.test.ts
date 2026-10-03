import assert from "node:assert/strict";
import { test } from "node:test";
import { userID } from "../src/domain/ids.ts";
import { HouseQueueOptimizer, type QueueForecast } from "../src/domain/services/house-queue-optimizer.ts";
import { decodeDebts, decodeGrid, loadFixture, outcome, type Outcome, type WeekTuple } from "./support/fixtures.ts";

interface RawTask {
  participants: string[];
  turns: { week: number; effort: number; eligible: string[]; incumbent: string | null; slot: number | null }[];
  isFixed: boolean;
  existingQueue: string[];
}
interface Case {
  name: string;
  input: { tasks: RawTask[]; fixed: Record<string, WeekTuple[]>; debts: Record<string, number | string> };
  output: Outcome<string[][]>;
}

function decodeTask(task: RawTask): QueueForecast {
  return {
    participants: task.participants.map(userID),
    turns: task.turns.map((t) => ({
      week: t.week, effort: t.effort, eligible: new Set(t.eligible.map(userID)),
      incumbent: t.incumbent === null ? null : userID(t.incumbent), slot: t.slot,
    })),
    isFixed: task.isFixed,
    existingQueue: task.existingQueue.map(userID),
  };
}

for (const c of loadFixture<Case>("house-queue-optimizer").cases) {
  test(`otimizador da casa (Swift): ${c.name}`, () => {
    const actual = outcome(() =>
      new HouseQueueOptimizer().optimize(c.input.tasks.map(decodeTask), decodeGrid(c.input.fixed), decodeDebts(c.input.debts))
    );
    assert.deepStrictEqual(actual, c.output);
  });
}
