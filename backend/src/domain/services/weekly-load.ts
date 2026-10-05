import type { Calendar, Instant } from "../dates.ts";
import { isActiveAssignment, isCompleted, type TaskAssignment, type TaskOccurrence } from "../entities.ts";
import type { UserID } from "../ids.ts";

/** Conta cada ocorrência uma vez, na semana de disponibilidade, com o esforço do snapshot. */
export class WeeklyLoadCalculator {
  calculate(
    userID: UserID,
    assignments: readonly TaskAssignment[],
    occurrences: readonly TaskOccurrence[],
    referenceDate: Instant,
    calendar: Calendar,
  ): number {
    const start = calendar.weekStart(referenceDate);
    const end = calendar.addWeeks(start, 1);
    const owned = new Set(assignments.filter((a) => a.userID === userID && isActiveAssignment(a)).map((a) => a.occurrenceID));
    let points = 0;
    for (const occurrence of occurrences) {
      const inWeek = occurrence.availableAt >= start && occurrence.availableAt < end;
      if (inWeek && (isCompleted(occurrence) ? occurrence.completedByUserID === userID : owned.has(occurrence.id))) {
        points += occurrence.effortSnapshot.points;
      }
    }
    return Math.max(0, points);
  }
}
