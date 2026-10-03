import { DomainError } from "../errors.ts";
import type { UserID } from "../ids.ts";

export class RotationCalculator {
  advance(index: number, queue: readonly UserID[]): number {
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) throw new DomainError("invalidDistribution");
    return (index + 1) % queue.length;
  }

  nextUser(currentUserID: UserID | null, eligibleUserIDs: readonly UserID[]): UserID | null {
    const first = eligibleUserIDs[0];
    if (first === undefined) return null;
    if (currentUserID === null) return first;
    const index = eligibleUserIDs.indexOf(currentUserID);
    if (index < 0) return first;
    return eligibleUserIDs[(index + 1) % eligibleUserIDs.length] ?? first;
  }
}
