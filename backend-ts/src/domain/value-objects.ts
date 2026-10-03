export type TaskKind = "recurring" | "sporadic";
export type RoomKind = "wholeHouse" | "standard";
export type RoomVisibility = "common" | "privateRoom";
export type RoomCategory =
  | "kitchen" | "bathroom" | "bedroom" | "livingRoom" | "laundry" | "office" | "outdoor" | "other";
export type TaskAssignmentPolicy = "balancedAutomatically" | "calendarRotation" | "afterCompletion" | "selfAssigned";
export type TaskOccurrenceStatus = "available" | "assigned" | "completed";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RoomColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "brown" | "gray" | "pink";

export const TASK_EFFORT_MIN = 1;
export const TASK_EFFORT_MAX = 3;

/** Esforço (1–3) é carga interna: não exibir como pontuação ou gamificação. */
export interface TaskEffort {
  readonly points: number;
}

/** Limita ao intervalo 1...3, como o `init` do Swift. */
export function taskEffort(points: number): TaskEffort {
  return { points: Math.min(Math.max(points, TASK_EFFORT_MIN), TASK_EFFORT_MAX) };
}

export interface WeeklyPeriodicity {
  readonly executionsPerPeriod: number;
  readonly intervalWeeks: number;
}

export function weeklyPeriodicity(executionsPerPeriod = 1, intervalWeeks = 1): WeeklyPeriodicity {
  return { executionsPerPeriod, intervalWeeks };
}

// Mesmo limite do Swift (`Int.max / 7`), restrito ao intervalo de inteiros exatos do JS.
const MAX_INTERVAL_WEEKS = Math.floor(Number.MAX_SAFE_INTEGER / 7);

export function isValidPeriodicity(value: WeeklyPeriodicity): boolean {
  const { intervalWeeks, executionsPerPeriod } = value;
  return (
    Number.isSafeInteger(intervalWeeks) && Number.isSafeInteger(executionsPerPeriod) &&
    intervalWeeks > 0 && intervalWeeks <= MAX_INTERVAL_WEEKS &&
    executionsPerPeriod > 0 && executionsPerPeriod <= intervalWeeks * 7
  );
}

export function periodicityLabel(value: WeeklyPeriodicity): string {
  return `${value.executionsPerPeriod} vez(es) a cada ${value.intervalWeeks} semana(s)`;
}

export function samePeriodicity(a: WeeklyPeriodicity, b: WeeklyPeriodicity): boolean {
  return a.executionsPerPeriod === b.executionsPerPeriod && a.intervalWeeks === b.intervalWeeks;
}

export type RecurrencePolicy =
  | { readonly kind: "none" }
  | { readonly kind: "recurring"; readonly frequency: RecurrenceFrequency; readonly interval: number }
  | { readonly kind: "weekly"; readonly periodicity: WeeklyPeriodicity };

export const NO_RECURRENCE: RecurrencePolicy = { kind: "none" };

export function recurring(frequency: RecurrenceFrequency, interval: number): RecurrencePolicy {
  return { kind: "recurring", frequency, interval };
}

export function weeklyRecurrence(periodicity: WeeklyPeriodicity): RecurrencePolicy {
  return { kind: "weekly", periodicity };
}

export function isRepeating(policy: RecurrencePolicy): boolean {
  return policy.kind !== "none";
}

export function hasValidInterval(policy: RecurrencePolicy): boolean {
  switch (policy.kind) {
    case "none": return true;
    case "recurring": return policy.interval > 0;
    case "weekly": return isValidPeriodicity(policy.periodicity);
    default: return assertNever(policy);
  }
}

/** `recurring(weekly, n)` equivale a 1 vez a cada n semanas. */
export function weeklyPeriodicityOf(policy: RecurrencePolicy): WeeklyPeriodicity | null {
  switch (policy.kind) {
    case "weekly": return policy.periodicity;
    case "recurring": return policy.frequency === "weekly" ? weeklyPeriodicity(1, policy.interval) : null;
    case "none": return null;
    default: return assertNever(policy);
  }
}

export function sameRecurrence(a: RecurrencePolicy, b: RecurrencePolicy): boolean {
  switch (a.kind) {
    case "none": return b.kind === "none";
    case "recurring": return b.kind === "recurring" && a.frequency === b.frequency && a.interval === b.interval;
    case "weekly": return b.kind === "weekly" && samePeriodicity(a.periodicity, b.periodicity);
    default: return assertNever(a);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Caso não tratado: ${JSON.stringify(value)}`);
}
