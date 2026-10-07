import { DomainError } from "../errors.ts";
import type { UserID } from "../ids.ts";
import { HungarianAlgorithm } from "./hungarian.ts";

export const HORIZON_WEEKS = 12;

/** Um bucket morador/semana. Imutável; sem entidades nem UUIDs dentro dos loops de custo. */
export interface ProjectedWeek {
  readonly load: number;
  readonly level1: number;
  readonly level2: number;
  readonly level3: number;
}

export const EMPTY_WEEK: ProjectedWeek = { load: 0, level1: 0, level2: 0, level3: 0 };

export function emptyWeeks(): ProjectedWeek[] {
  return new Array<ProjectedWeek>(HORIZON_WEEKS).fill(EMPTY_WEEK);
}

export function addEffort(week: ProjectedWeek, effort: number): ProjectedWeek {
  const load = week.load + effort;
  switch (effort) {
    case 1: return { ...week, load, level1: week.level1 + 1 };
    case 2: return { ...week, load, level2: week.level2 + 1 };
    default: return { ...week, load, level3: week.level3 + 1 };
  }
}

export function weekCost(week: ProjectedWeek, debt: number): number {
  const adjusted = week.load + debt;
  return adjusted * adjusted + 0.5 * (week.level1 * week.level1 + week.level2 * week.level2 + week.level3 * week.level3);
}

export type Projection = ReadonlyMap<UserID, readonly ProjectedWeek[]>;
export type DebtMap = ReadonlyMap<UserID, number>;

export function isValidProjection(projection: Projection): boolean {
  for (const weeks of projection.values()) {
    if (weeks.length !== HORIZON_WEEKS) return false;
    for (const w of weeks) {
      if (
        !(Number.isFinite(w.load) && w.load >= 0 && Number.isFinite(w.level1) && w.level1 >= 0 &&
          Number.isFinite(w.level2) && w.level2 >= 0 && Number.isFinite(w.level3) && w.level3 >= 0)
      ) return false;
    }
  }
  return true;
}

export class TaskDistributionEngine {
  readonly optimizer: HungarianAlgorithm;

  constructor(optimizer: HungarianAlgorithm = new HungarianAlgorithm()) {
    this.optimizer = optimizer;
  }

  /** `occurrenceWeeks` lista a semana de cada ocorrência cronológica (duplicatas permitidas). */
  generateInitialQueue(
    taskEffort: number,
    participants: readonly UserID[],
    occurrenceWeeks: readonly number[],
    projection: Projection,
    debts: DebtMap,
  ): UserID[] {
    this.validate(taskEffort, participants, occurrenceWeeks, projection, debts);
    if (participants.length === 0) throw new DomainError("noEligibleMembers");
    const count = participants.length;
    const matrix = participants.map((user) =>
      participants.map((_, slot) => {
        const weeks = [...(projection.get(user) ?? emptyWeeks())];
        occurrenceWeeks.forEach((week, index) => {
          if (index % count === slot) {
            const current = weeks[week];
            if (current === undefined) throw new DomainError("invalidDistribution");
            weeks[week] = addEffort(current, taskEffort);
          }
        });
        const debt = (debts.get(user) ?? 0) / 12;
        return weeks.reduce((sum, week) => sum + weekCost(week, debt), 0);
      })
    );
    const assignment = this.optimizer.solve(matrix);
    const queue = [...participants];
    participants.forEach((user, row) => {
      const column = assignment[row];
      if (column === undefined) throw new DomainError("invalidDistribution");
      queue[column] = user;
    });
    return queue;
  }

  private validate(
    effort: number, queue: readonly UserID[], weeks: readonly number[], projection: Projection, debts: DebtMap,
  ): void {
    const valid = Number.isInteger(effort) && effort >= 1 && effort <= 3 &&
      new Set(queue).size === queue.length &&
      weeks.every((w) => Number.isInteger(w) && w >= 0 && w < HORIZON_WEEKS) &&
      [...debts.values()].every(Number.isFinite) &&
      isValidProjection(projection);
    if (!valid) throw new DomainError("invalidDistribution");
  }
}
