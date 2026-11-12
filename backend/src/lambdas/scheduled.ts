import type { Instant } from "../domain/dates.ts";
import type { HouseID, UserID } from "../domain/ids.ts";

// Lambda `scheduled` (EventBridge, de hora em hora): para cada casa, cria os avisos que dependem do tempo ("o ciclo
// virou", "o resumo da semana está pronto", "lembrete das tarefas"). Idempotente; uma casa com erro não impede as outras.
// Sem conteúdo em log.

export interface ScheduledDependencies {
  readonly houseIDs: () => Promise<readonly HouseID[]>;
  /** Quem quer o lembrete diário da casa (preferência ligada e aparelho registrado) e a hora local dele (0 a 23). */
  readonly reminderHours: (houseID: HouseID) => Promise<ReadonlyMap<UserID, number>>;
  readonly emit: (houseID: HouseID, at: Instant, reminderHours: ReadonlyMap<UserID, number>) => Promise<number>;
  readonly now: () => Instant;
  readonly onFailure: (description: string) => void;
}

export interface ScheduledResult {
  readonly houses: number;
  readonly created: number;
  readonly failures: number;
}

export function createScheduledHandler(deps: ScheduledDependencies): (event: unknown) => Promise<ScheduledResult> {
  return async () => {
    const houses = await deps.houseIDs();
    let created = 0;
    let failures = 0;
    for (const houseID of houses) {
      try {
        const at = deps.now();
        created += await deps.emit(houseID, at, await deps.reminderHours(houseID));
      } catch (error) {
        failures += 1;
        deps.onFailure(error instanceof Error ? error.name : "erro");
      }
    }
    return { houses: houses.length, created, failures };
  };
}
