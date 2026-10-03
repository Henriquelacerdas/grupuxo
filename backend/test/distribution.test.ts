import { at } from "../src/domain/arrays.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDomainError } from "../src/domain/errors.ts";
import { userID } from "../src/domain/ids.ts";
import { FairnessCalculator } from "../src/domain/services/fairness.ts";
import { HungarianAlgorithm } from "../src/domain/services/hungarian.ts";
import { addEffort, emptyWeeks, TaskDistributionEngine, type ProjectedWeek } from "../src/domain/services/task-distribution-engine.ts";
import { permutations, uuid } from "./support/world.ts";

const engine = new TaskDistributionEngine();
const solver = new HungarianAlgorithm();
const user = (n: number) => userID(uuid(n));
const invalid = (error: unknown) => isDomainError(error, "invalidDistribution");

test("ótimo conhecido e custos negativos", () => {
  assert.deepEqual(solver.solve([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  assert.deepEqual(solver.solve([[-4, -1], [-2, -5]]), [0, 1]);
  assert.deepEqual(solver.solve([]), []);
  assert.deepEqual(solver.solve([[3]]), [0]);
  assert.deepEqual(solver.solve([[0, 0], [0, 0]]), [0, 1]);
});

test("matrizes malformadas falham", () => {
  assert.throws(() => solver.solve([[1, 2]]), invalid);
  assert.throws(() => solver.solve([[NaN]]), invalid);
  assert.throws(() => solver.solve([[Infinity]]), invalid);
});

test("o ótimo coincide com a busca exaustiva (vários tamanhos, custos negativos e empatados)", () => {
  for (let n = 1; n <= 6; n++) {
    for (let seed = 0; seed < 8; seed++) {
      const matrix = Array.from({ length: n }, (_, row) =>
        Array.from({ length: n }, (_, col) => ((row + 3) * (col + seed + 1) * 17 + col * col) % 29 - 14));
      const assignment = solver.solve(matrix);
      const cost = (candidate: readonly number[]) => candidate.reduce((sum, column, row) => sum + (matrix[row]?.[column] ?? NaN), 0);
      const oracle = Math.min(...permutations(Array.from({ length: n }, (_, i) => i)).map(cost));
      assert.equal(cost(assignment), oracle);
      assert.equal(new Set(assignment).size, n);
    }
  }
});

test("picos semanais determinam a fase", () => {
  const [a, b] = [user(1), user(2)];
  const aWeeks = emptyWeeks();
  const bWeeks = emptyWeeks();
  for (let week = 0; week < 12; week++) {
    if (week % 2 === 0) aWeeks[week] = addEffort(at(aWeeks, week), 3);
    else bWeeks[week] = addEffort(at(bWeeks, week), 3);
  }
  const queue = engine.generateInitialQueue(3, [a, b], Array.from({ length: 12 }, (_, i) => i), new Map([[a, aWeeks], [b, bWeeks]]), new Map());
  assert.deepEqual(queue, [b, a]);
});

test("saldo positivo atrasa a primeira vez e a fila é uma permutação", () => {
  const [a, b, c] = [user(1), user(2), user(3)];
  const queue = engine.generateInitialQueue(2, [a, b, c], [0], new Map(), new Map([[a, 12], [b, -12]]));
  assert.equal(queue[0], b);
  assert.deepEqual(new Set(queue), new Set([a, b, c]));
  assert.equal(queue.length, 3);
});

test("justiça tem soma zero e deduplica membros", () => {
  const [a, b, c] = [user(1), user(2), user(3)];
  const result = new FairnessCalculator().calculateDebtImpact(2, a, [a, b, c, a]);
  const sum = Object.values(result).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum) < 1e-12);
  assert.ok(Math.abs((result[a] ?? NaN) - 4 / 3) < 1e-12);
  assert.equal(result[b], result[c]);
  assert.throws(() => new FairnessCalculator().calculateDebtImpact(2, user(9), [a]), invalid);
  assert.deepEqual(new FairnessCalculator().calculateDebtImpact(3, a, [a]), { [a]: 0 });
});

test("a mistura de dificuldade desempata cargas iguais", () => {
  const [a, b] = [user(1), user(2)];
  const aWeeks = emptyWeeks();
  const bWeeks = emptyWeeks();
  aWeeks[0] = addEffort(at(aWeeks, 0), 3);
  for (let i = 0; i < 3; i++) bWeeks[0] = addEffort(at(bWeeks, 0), 1);
  const queue = engine.generateInitialQueue(3, [a, b], [0], new Map([[a, aWeeks], [b, bWeeks]]), new Map());
  assert.equal(queue[0], b);
});

test("entradas inválidas do motor falham", () => {
  const a = user(1);
  assert.throws(() => engine.generateInitialQueue(2, [a, a], [0], new Map(), new Map()), invalid);
  assert.throws(() => engine.generateInitialQueue(2, [a], [12], new Map(), new Map()), invalid);
  assert.throws(() => engine.generateInitialQueue(2, [a], [0], new Map(), new Map([[a, NaN]])), invalid);
});
