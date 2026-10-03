import { createCalendar, type Instant } from "../dates.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, IDGenerator } from "../ids.ts";
import { TaskSchedulingService } from "../services/task-scheduling-service.ts";
import type { StoreState } from "../store-state.ts";

/** Dependências injetadas: o domínio não tem relógio nem gerador de IDs globais. */
export interface CommandContext {
  readonly now: () => Instant;
  readonly newID: IDGenerator;
}

/** Serviço de agendamento com o calendário do fuso da casa (a virada de semana é no fuso dela). */
export function schedulingFor(ctx: CommandContext, state: StoreState, houseID: HouseID): TaskSchedulingService {
  const house = state.houses.find((h) => h.id === houseID);
  if (house === undefined) throw new DomainError("entityNotFound");
  return new TaskSchedulingService({ calendar: createCalendar(house.timezone), newID: ctx.newID });
}
