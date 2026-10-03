import { DomainError } from "../errors.ts";
import { compareIDs, type UserID } from "../ids.ts";
import {
  addCosts, costIsFinite, costLess, HungarianAlgorithm, scheduleCost, ZERO_COST, type ScheduleCost,
} from "./hungarian.ts";
import {
  addEffort, emptyWeeks, HORIZON_WEEKS, isValidProjection, type DebtMap, type ProjectedWeek, type Projection,
} from "./task-distribution-engine.ts";

export interface QueueTurn {
  readonly week: number;
  readonly effort: number;
  readonly eligible: ReadonlySet<UserID>;
  readonly incumbent: UserID | null;
  /** Posição do bloco na fila do cômodo; sem ela, vale o índice do turno. */
  readonly slot: number | null;
}

export interface QueueForecast {
  readonly participants: readonly UserID[];
  readonly turns: readonly QueueTurn[];
  readonly isFixed: boolean;
  /** Começa na primeira ocorrência replanejada. */
  readonly existingQueue: readonly UserID[];
}

type Grid = Map<UserID, readonly ProjectedWeek[]>;

function sortedUsers(users: readonly UserID[]): UserID[] {
  return [...users].sort(compareIDs);
}

function copyGrid(grid: Projection): Grid {
  return new Map(grid);
}

function userCost(weeks: readonly ProjectedWeek[], debt: number): ScheduleCost {
  return weeks.reduce<ScheduleCost>(
    (total, week) =>
      addCosts(total, scheduleCost({
        effort: week.load * week.load,
        difficulty: week.level1 * week.level1 + week.level2 * week.level2 + week.level3 * week.level3,
        debt: 2 * week.load * debt / 12,
      })),
    ZERO_COST,
  );
}

function addTask(task: QueueForecast, queue: readonly UserID[], grid: Grid): void {
  if (queue.length === 0) return;
  task.turns.forEach((turn, i) => {
    const user = queue[(turn.slot ?? i) % queue.length];
    if (user === undefined || !turn.eligible.has(user)) return;
    const weeks = [...(grid.get(user) ?? emptyWeeks())];
    const current = weeks[turn.week];
    if (current === undefined) throw new DomainError("invalidDistribution");
    weeks[turn.week] = addEffort(current, turn.effort);
    grid.set(user, weeks);
  });
}

/**
 * Reequilíbrio da casa: busca local lexicográfica (até 20 passagens por configuração inicial), com o
 * Húngaro resolvendo cada fila com as demais fixas. Determinística; não promete ótimo global.
 */
export class HouseQueueOptimizer {
  optimize(tasks: readonly QueueForecast[], fixed: Projection, debts: DebtMap): UserID[][] {
    const valid = isValidProjection(fixed) && [...debts.values()].every(Number.isFinite) &&
      tasks.every((task) =>
        new Set(task.participants).size === task.participants.length &&
        new Set(task.existingQueue).size === task.existingQueue.length &&
        task.turns.every((t) =>
          Number.isInteger(t.week) && t.week >= 0 && t.week < HORIZON_WEEKS &&
          Number.isInteger(t.effort) && t.effort >= 1 && t.effort <= 3 && (t.slot ?? 0) >= 0
        )
      );
    if (!valid) throw new DomainError("invalidDistribution");

    const adapted = tasks.map((task) => {
      const retained = task.existingQueue.filter((u) => task.participants.includes(u));
      return [...retained, ...sortedUsers(task.participants.filter((u) => !retained.includes(u)))];
    });
    const rebuilt = tasks.map((task, i) => (task.isFixed ? [...adaptedAt(adapted, i)] : sortedUsers(task.participants)));
    let best = adapted;
    let bestCost = this.score(tasks, best, fixed, debts);
    for (const initial of [adapted, rebuilt]) {
      let queues = initial.map((q) => [...q]);
      let cost = this.score(tasks, queues, fixed, debts);
      for (let pass = 0; pass < 20; pass++) {
        let improved = false;
        for (let index = 0; index < tasks.length; index++) {
          const task = tasks[index];
          if (task === undefined || task.participants.length === 0 || task.isFixed) continue;
          const base = copyGrid(fixed);
          tasks.forEach((other, otherIndex) => {
            if (otherIndex !== index) addTask(other, adaptedAt(queues, otherIndex), base);
          });
          const users = sortedUsers(task.participants);
          const matrix = users.map((user) =>
            users.map((_, slot) => {
              const weeks = [...(base.get(user) ?? emptyWeeks())];
              let changes = 0;
              task.turns.forEach((turn, turnIndex) => {
                if ((turn.slot ?? turnIndex) % users.length !== slot) return;
                const owner = turn.eligible.has(user) ? user : null;
                if (owner !== null) {
                  const current = weeks[turn.week];
                  if (current === undefined) throw new DomainError("invalidDistribution");
                  weeks[turn.week] = addEffort(current, turn.effort);
                }
                if (owner !== turn.incumbent) changes += 1;
              });
              return { ...userCost(weeks, debts.get(user) ?? 0), changes };
            })
          );
          const assignment = new HungarianAlgorithm().solveLexicographic(matrix);
          const candidate = queues.map((q) => [...q]);
          const target = adaptedAt(candidate, index);
          users.forEach((user, row) => {
            const column = assignment[row];
            if (column === undefined) throw new DomainError("invalidDistribution");
            target[column] = user;
          });
          const candidateCost = this.score(tasks, candidate, fixed, debts);
          if (costLess(candidateCost, cost)) {
            queues = candidate;
            cost = candidateCost;
            improved = true;
          }
        }
        if (!improved) break;
      }
      if (costLess(cost, bestCost)) {
        best = queues;
        bestCost = cost;
      }
    }
    return best.map((q) => [...q]);
  }

  score(tasks: readonly QueueForecast[], queues: readonly (readonly UserID[])[], fixed: Projection, debts: DebtMap): ScheduleCost {
    const grid = copyGrid(fixed);
    let changes = 0;
    tasks.forEach((task, i) => {
      const queue = adaptedAt(queues, i);
      addTask(task, queue, grid);
      task.turns.forEach((turn, j) => {
        const nominal = queue.length === 0 ? null : (queue[(turn.slot ?? j) % queue.length] ?? null);
        const owner = nominal !== null && turn.eligible.has(nominal) ? nominal : null;
        if (owner !== turn.incumbent) changes += 1;
      });
    });
    let result = scheduleCost({ changes });
    for (const user of [...grid.keys()].sort(compareIDs)) {
      result = addCosts(result, userCost(grid.get(user) ?? emptyWeeks(), debts.get(user) ?? 0));
    }
    if (!costIsFinite(result)) throw new DomainError("invalidDistribution");
    return result;
  }
}

function adaptedAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new DomainError("invalidDistribution");
  return value;
}
