import { DomainError } from "../errors.ts";

/** Custo composto comparado em ordem lexicográfica, sem pesos escalares que possam inverter prioridades. */
export interface ScheduleCost {
  readonly effort: number;
  readonly difficulty: number;
  readonly debt: number;
  readonly changes: number;
}

export const ZERO_COST: ScheduleCost = { effort: 0, difficulty: 0, debt: 0, changes: 0 };
export const INFINITE_COST: ScheduleCost = { effort: Infinity, difficulty: 0, debt: 0, changes: 0 };

export function scheduleCost(parts: Partial<ScheduleCost> = {}): ScheduleCost {
  return { ...ZERO_COST, ...parts };
}

export function costIsFinite(cost: ScheduleCost): boolean {
  return Number.isFinite(cost.effort) && Number.isFinite(cost.difficulty) &&
    Number.isFinite(cost.debt) && Number.isFinite(cost.changes);
}

export function costLess(a: ScheduleCost, b: ScheduleCost): boolean {
  if (a.effort !== b.effort) return a.effort < b.effort;
  if (a.difficulty !== b.difficulty) return a.difficulty < b.difficulty;
  if (a.debt !== b.debt) return a.debt < b.debt;
  return a.changes < b.changes;
}

export function addCosts(a: ScheduleCost, b: ScheduleCost): ScheduleCost {
  return {
    effort: a.effort + b.effort, difficulty: a.difficulty + b.difficulty,
    debt: a.debt + b.debt, changes: a.changes + b.changes,
  };
}

export function subtractCosts(a: ScheduleCost, b: ScheduleCost): ScheduleCost {
  return {
    effort: a.effort - b.effort, difficulty: a.difficulty - b.difficulty,
    debt: a.debt - b.debt, changes: a.changes - b.changes,
  };
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new DomainError("invalidDistribution");
  return value;
}

/**
 * Bijeção de custo mínimo (método dos potenciais): `resultado[linha]` é a coluna da linha.
 * O(n³) em tempo e O(n) de memória auxiliar. A ordem das operações em ponto flutuante é a do Swift.
 */
export class HungarianAlgorithm {
  solve(matrix: readonly (readonly number[])[]): number[] {
    const n = matrix.length;
    if (!matrix.every((row) => row.length === n && row.every(Number.isFinite))) {
      throw new DomainError("invalidDistribution");
    }
    if (n === 0) return [];
    const u: number[] = new Array<number>(n + 1).fill(0);
    const v: number[] = new Array<number>(n + 1).fill(0);
    const p: number[] = new Array<number>(n + 1).fill(0);
    const way: number[] = new Array<number>(n + 1).fill(0);
    for (let row = 1; row <= n; row++) {
      p[0] = row;
      let column = 0;
      const minimum: number[] = new Array<number>(n + 1).fill(Infinity);
      const used: boolean[] = new Array<boolean>(n + 1).fill(false);
      do {
        used[column] = true;
        const currentRow = at(p, column);
        let delta = Infinity;
        let nextColumn = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cost = at(at(matrix, currentRow - 1), j - 1) - at(u, currentRow) - at(v, j);
          if (!Number.isFinite(cost)) throw new DomainError("invalidDistribution");
          if (cost < at(minimum, j)) {
            minimum[j] = cost;
            way[j] = column;
          }
          if (at(minimum, j) < delta) {
            delta = at(minimum, j);
            nextColumn = j;
          }
        }
        if (!Number.isFinite(delta)) throw new DomainError("invalidDistribution");
        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            const owner = at(p, j);
            u[owner] = at(u, owner) + delta;
            v[j] = at(v, j) - delta;
          } else {
            minimum[j] = at(minimum, j) - delta;
          }
        }
        column = nextColumn;
      } while (at(p, column) !== 0);
      do {
        const previous = at(way, column);
        p[column] = at(p, previous);
        column = previous;
      } while (column !== 0);
    }
    const result: number[] = new Array<number>(n).fill(0);
    for (let j = 1; j <= n; j++) result[at(p, j) - 1] = j - 1;
    return result;
  }

  /** Mesmo algoritmo sobre custos aditivos ordenados lexicograficamente. */
  solveLexicographic(costs: readonly (readonly ScheduleCost[])[]): number[] {
    const n = costs.length;
    if (!costs.every((row) => row.length === n && row.every(costIsFinite))) {
      throw new DomainError("invalidDistribution");
    }
    if (n === 0) return [];
    const u: ScheduleCost[] = new Array<ScheduleCost>(n + 1).fill(ZERO_COST);
    const v: ScheduleCost[] = new Array<ScheduleCost>(n + 1).fill(ZERO_COST);
    const p: number[] = new Array<number>(n + 1).fill(0);
    const way: number[] = new Array<number>(n + 1).fill(0);
    for (let row = 1; row <= n; row++) {
      p[0] = row;
      let column = 0;
      const minimum: ScheduleCost[] = new Array<ScheduleCost>(n + 1).fill(INFINITE_COST);
      const used: boolean[] = new Array<boolean>(n + 1).fill(false);
      do {
        used[column] = true;
        const currentRow = at(p, column);
        let delta = INFINITE_COST;
        let next = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cost = subtractCosts(subtractCosts(at(at(costs, currentRow - 1), j - 1), at(u, currentRow)), at(v, j));
          if (!costIsFinite(cost)) throw new DomainError("invalidDistribution");
          if (costLess(cost, at(minimum, j))) {
            minimum[j] = cost;
            way[j] = column;
          }
          if (costLess(at(minimum, j), delta)) {
            delta = at(minimum, j);
            next = j;
          }
        }
        if (!costIsFinite(delta)) throw new DomainError("invalidDistribution");
        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            const owner = at(p, j);
            u[owner] = addCosts(at(u, owner), delta);
            v[j] = subtractCosts(at(v, j), delta);
          } else {
            minimum[j] = subtractCosts(at(minimum, j), delta);
          }
        }
        column = next;
      } while (at(p, column) !== 0);
      do {
        const previous = at(way, column);
        p[column] = at(p, previous);
        column = previous;
      } while (column !== 0);
    }
    const result: number[] = new Array<number>(n).fill(0);
    for (let j = 1; j <= n; j++) result[at(p, j) - 1] = j - 1;
    return result;
  }
}
