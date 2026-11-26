import type { Instant } from "../domain/dates.ts";
import type { HouseID } from "../domain/ids.ts";

// Lambda `scheduled` (EventBridge, de hora em hora): para cada casa, cria os avisos que dependem do tempo ("o ciclo
// virou", "o resumo da semana está pronto") e, depois, manda o lembrete diário das tarefas por Web Push a quem pediu
// para esta hora (`remind`). Idempotente; uma casa com erro não impede as outras. Sem conteúdo em log.
//
// As casas são processadas em paralelo (até `concurrency` ao mesmo tempo; cada uma é uma partição e uma escrita
// independente) e com um orçamento de tempo: ao estourar, para de começar casas novas e devolve quantas ficaram para
// trás (`skipped`), em vez de ser morta pelo timeout no meio de uma casa. A ordem começa numa casa diferente a cada
// hora, para que, com mais casas do que cabem no orçamento, nenhuma fique sempre no fim da fila.

export interface ScheduledDependencies {
  readonly houseIDs: () => Promise<readonly HouseID[]>;
  readonly emit: (houseID: HouseID, at: Instant) => Promise<number>;
  /** Lembrete diário (Web Push) da casa, depois dos avisos; devolve quantos pushes saíram. Ausente = sem lembrete. */
  readonly remind?: (houseID: HouseID, at: Instant) => Promise<number>;
  readonly now: () => Instant;
  readonly onFailure: (description: string) => void;
  /** Casas processadas ao mesmo tempo (>= 1). */
  readonly concurrency: number;
  /** Tempo máximo, em ms, desde o início do handler para começar casas novas; sem valor, não há limite. */
  readonly timeBudgetMs?: number;
}

export interface ScheduledResult {
  readonly houses: number;
  readonly created: number;
  /** Pushes do lembrete diário enviados. */
  readonly reminded: number;
  readonly failures: number;
  /** Casas que não foram começadas porque o orçamento de tempo acabou (a próxima rodada cobre outras). */
  readonly skipped: number;
}

const HOUR_MS = 3_600_000;

export function createScheduledHandler(deps: ScheduledDependencies): (event: unknown) => Promise<ScheduledResult> {
  if (!Number.isInteger(deps.concurrency) || deps.concurrency < 1) throw new RangeError("scheduled: concurrency inválida");
  return async () => {
    const startedAt = deps.now();
    const deadline = deps.timeBudgetMs === undefined ? undefined : startedAt + deps.timeBudgetMs;
    const listed = await deps.houseIDs();
    const start = listed.length === 0 ? 0 : Math.floor(startedAt / HOUR_MS) % listed.length;
    const houses = [...listed.slice(start), ...listed.slice(0, start)];

    let next = 0;
    let created = 0;
    let reminded = 0;
    let failures = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const now = deps.now();
        if (deadline !== undefined && now >= deadline) return;
        const houseID = houses[next];
        if (houseID === undefined) return;
        next += 1;
        try {
          const count = await deps.emit(houseID, now); // soma depois do await: `created += await` perderia somas concorrentes
          created += count;
          if (deps.remind !== undefined) {
            const pushes = await deps.remind(houseID, now);
            reminded += pushes;
          }
        } catch (error) {
          failures += 1;
          deps.onFailure(error instanceof Error ? error.name : "erro");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(deps.concurrency, houses.length) }, worker));
    return { houses: houses.length, created, reminded, failures, skipped: houses.length - next };
  };
}
