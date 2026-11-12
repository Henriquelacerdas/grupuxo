import type { Instant } from "../domain/dates.ts";
import type { HouseID } from "../domain/ids.ts";

// Lambda `scheduled` (EventBridge, de hora em hora): para cada casa, cria os avisos que dependem do tempo ("o ciclo
// virou", "o resumo da semana está pronto"). Idempotente; uma casa com erro não impede as outras. Sem conteúdo em log.

export interface ScheduledDependencies {
  readonly houseIDs: () => Promise<readonly HouseID[]>;
  readonly emit: (houseID: HouseID, at: Instant) => Promise<number>;
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
        created += await deps.emit(houseID, deps.now());
      } catch (error) {
        failures += 1;
        deps.onFailure(error instanceof Error ? error.name : "erro");
      }
    }
    return { houses: houses.length, created, failures };
  };
}
