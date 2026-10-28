// Telemetria sem I/O: somente nomes constantes e números. Relógio e destino entram por injeção.
export const LATENCY_STAGES = [
  "totalMs", "setupMs", "claimMs", "rateLimitMs", "linkMs", "resolveHouseMs", "roomsMs", "responderMs",
  "geminiMs", "geminiAttemptMs", "geminiRetrySleepMs", "toolMs", "houseReadMs", "houseUpdateMs",
  "houseLoadMs", "houseQueryMs", "houseDecodeMs", "profileMs", "houseBaselineMs", "houseCloneMs",
  "houseCommandMs", "houseDiffMs", "houseWriteMs", "graphMs", "markProcessedMs", "enqueueMs",
] as const;
export const LATENCY_COUNTERS = [
  "batchSize", "batchIndex", "receiveCount", "firstQueueWaitMs", "queueDispatchMs", "batchWaitMs", "sourceToWorkerMs",
  "sourceToGraphMs", "metaDeliveryMs", "timestampFallbacks", "invalidTimestamps", "textMessages",
  "enqueuedMessages", "geminiRounds", "geminiAttempts", "geminiRetries", "geminiFailures", "geminiCutoffs",
  "toolCalls", "toolProblems", "myTaskCalls", "roomTaskCalls", "sporadicTaskCalls", "completionRequests", "completionConfirmations", "houseLoads", "housePages", "houseItems", "profileBatches", "profiles",
  "houseConflicts", "houseTransactions", "graphCalls", "graphStatus", "graphFailures", "graphTimeouts", "graphNetworkFailures", "replyChars",
  "responderTruncations", "graphTruncations",
] as const;
export type LatencyStage = typeof LATENCY_STAGES[number];
export type LatencyCounter = typeof LATENCY_COUNTERS[number];
export type LatencyKind = "message" | "webhook" | "setup" | "batch";
export type LatencyOutcome = "success" | "failure" | "duplicate" | "limited" | "blocked_group" | "rejected";
export type AttemptOutcome = "success" | "timeout" | "network" | "status" | "invalidResponse" | "blocked" | "failure";
export interface GeminiAttemptTiming {
  readonly durationMs: number;
  readonly outcome: AttemptOutcome;
  readonly status: number | null;
}
export interface LatencyObserver {
  /** Fecha uma duração inclusive se a operação falhar. Não depende de Date global. */
  start(stage: LatencyStage): () => number;
  add(counter: LatencyCounter, amount?: number): void;
  outcome(value: LatencyOutcome): void;
  attempt(sample: GeminiAttemptTiming): void;
}
export interface LatencyScope {
  readonly wallNow: () => number;
  readonly invocationStartedAt?: () => number;
  run<T>(kind: LatencyKind, operation: (observer: LatencyObserver) => Promise<T>): Promise<T>;
}
export const noLatency: LatencyObserver = {
  start: () => () => 0, add: () => {}, outcome: () => {}, attempt: () => {},
};

const OUTCOMES: readonly string[] = ["success", "failure", "duplicate", "limited", "blocked_group", "rejected"];
const ATTEMPT_OUTCOMES: readonly string[] = ["success", "timeout", "network", "status", "invalidResponse", "blocked", "failure"];
const valid = (value: number): boolean => Number.isFinite(value) && value >= 0;
const rounded = (value: number): number => Number(value.toFixed(3));
const GAUGES: readonly LatencyCounter[] = ["batchSize", "batchIndex", "receiveCount", "firstQueueWaitMs", "queueDispatchMs", "batchWaitMs",
  "sourceToWorkerMs", "sourceToGraphMs", "metaDeliveryMs", "graphStatus"];
export type LatencyReport = Readonly<Partial<Record<LatencyStage | LatencyCounter, number>>> & {
  readonly event: "whatsapp_latency"; readonly version: 1; readonly kind: LatencyKind; readonly outcome: LatencyOutcome;
  readonly geminiAttemptTimings: readonly GeminiAttemptTiming[];
};

/** Uma instância por mensagem/requisição; nunca recebe mensagem, erro, argumentos ou identificadores. */
export class LatencyMeasurement implements LatencyObserver {
  private readonly values: Partial<Record<LatencyStage | LatencyCounter, number>> = {};
  private readonly attempts: GeminiAttemptTiming[] = [];
  private result: LatencyOutcome = "failure";
  private readonly clock: () => number;
  private readonly kind: LatencyKind;

  constructor(kind: LatencyKind, clock: () => number) {
    this.kind = kind; this.clock = clock;
    for (const counter of LATENCY_COUNTERS) if (!GAUGES.includes(counter)) this.values[counter] = 0;
  }

  start(stage: LatencyStage): () => number {
    const started = this.clock();
    let duration: number | undefined;
    return () => {
      if (duration !== undefined) return duration;
      duration = Math.max(0, this.clock() - started);
      if (LATENCY_STAGES.includes(stage) && valid(duration)) this.values[stage] = (this.values[stage] ?? 0) + duration;
      return duration;
    };
  }

  add(counter: LatencyCounter, amount = 1): void {
    if (LATENCY_COUNTERS.includes(counter) && valid(amount)) this.values[counter] = (this.values[counter] ?? 0) + amount;
  }

  outcome(value: LatencyOutcome): void { if (OUTCOMES.includes(value)) this.result = value; }

  attempt(sample: GeminiAttemptTiming): void {
    if (this.attempts.length >= 16 || !valid(sample.durationMs) || !ATTEMPT_OUTCOMES.includes(sample.outcome)) return;
    // Reconstrói campos, sem espalhar um objeto que possa trazer dados extras.
    this.attempts.push({ durationMs: rounded(sample.durationMs), outcome: sample.outcome,
      status: sample.status !== null && Number.isInteger(sample.status) && sample.status >= 100 && sample.status <= 599 ? sample.status : null });
  }

  report(): LatencyReport {
    return { event: "whatsapp_latency", version: 1, kind: this.kind, outcome: this.result,
      ...Object.fromEntries(Object.entries(this.values).map(([key, value]) => [key, rounded(value)])),
      geminiAttemptTimings: this.attempts.map((sample) => ({ ...sample })) };
  }
}

/** Duração derivada de timestamps; ausente/inválido não vira uma latência zero. */
export function recordAge(observer: LatencyObserver, field: LatencyCounter, end: number, start: number | undefined): void {
  if (start === undefined) return;
  const age = end - start;
  if (valid(start) && valid(age)) observer.add(field, age);
  else observer.add("invalidTimestamps");
}

export async function measure<T>(observer: LatencyObserver, stage: LatencyStage, operation: () => Promise<T>): Promise<T> {
  const stop = observer.start(stage);
  try { return await operation(); } finally { stop(); }
}

export function measureSync<T>(observer: LatencyObserver, stage: LatencyStage, operation: () => T): T {
  const stop = observer.start(stage);
  try { return operation(); } finally { stop(); }
}
