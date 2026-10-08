import { DomainError } from "../errors.ts";
import type { UserID } from "../ids.ts";
import { TASK_EFFORT_MAX, TASK_EFFORT_MIN } from "../value-objects.ts";

export class FairnessCalculator {
  /**
   * Impacto no saldo de cada elegível: `E − E/M` ao executor e `−E/M` aos demais (soma zero).
   * Deduplica os IDs; exige esforço 1...3 e o executor entre os elegíveis.
   */
  calculateDebtImpact(effort: number, executorID: UserID, eligibleUserIDs: readonly UserID[]): Record<string, number> {
    const members = new Set(eligibleUserIDs);
    if (
      !Number.isInteger(effort) || effort < TASK_EFFORT_MIN || effort > TASK_EFFORT_MAX ||
      members.size === 0 || !members.has(executorID)
    ) {
      throw new DomainError("invalidDistribution");
    }
    const share = effort / members.size;
    const impacts: Record<string, number> = {};
    for (const member of members) impacts[member] = (member === executorID ? effort : 0) - share;
    return impacts;
  }
}
