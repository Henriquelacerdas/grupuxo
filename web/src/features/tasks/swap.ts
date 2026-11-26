import type { TaskItem } from "@/lib/api/types";

export interface CandidateGroup {
  readonly effort: number;
  readonly isSameEffort: boolean;
  readonly items: readonly TaskItem[];
}

const level = (item: TaskItem): number => Math.min(3, Math.max(1, item.occurrence.effort));

/** Por esforço: primeiro o mesmo da sua tarefa, depois os outros, do mais leve ao mais intenso (TaskSwapViewModel). */
export function candidateGroups(offered: TaskItem, candidates: readonly TaskItem[]): CandidateGroup[] {
  const mine = level(offered);
  const order = [mine, ...[1, 2, 3].filter((l) => l !== mine)];
  return order.flatMap((effort) => {
    const items = candidates.filter((c) => level(c) === effort).sort((a, b) => {
      if (a.definition.name !== b.definition.name) return a.definition.name < b.definition.name ? -1 : 1;
      const x = a.occurrence.id.toLowerCase();
      const y = b.occurrence.id.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return items.length === 0 ? [] : [{ effort, isSameEffort: effort === mine, items }];
  });
}
