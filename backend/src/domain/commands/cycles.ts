import { lastWhere } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import type { HouseID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";
import { houseResidentIDs, notifyAll } from "./notifications.ts";
import { ratingSummary, responsibleAt } from "./ratings.ts";

// Avisos que dependem da passagem do tempo ("o ciclo virou", "o resumo da semana está pronto"). Quem chama é a tarefa
// agendada (EventBridge, de hora em hora); os comandos são idempotentes: repetir no mesmo ciclo não duplica aviso.

/**
 * "O ciclo de <cômodo> virou": para quem cuida do cômodo no ciclo que começou. Vale a partir do segundo ciclo (o primeiro
 * começa com o cômodo). Um aviso por pessoa e ciclo. Devolve quantos avisos criou.
 */
export function emitCycleNotifications(ctx: CommandContext, state: StoreState, houseID: HouseID, date: Instant): number {
  let created = 0;
  const scheduling = schedulingFor(ctx, state, houseID);
  for (const room of state.rooms.filter((r) => r.houseID === houseID)) {
    if (room.calendarAnchor === null || room.scheduleVersions.length === 0) continue;
    const index = scheduling.periodIndex(room, date);
    if (index < 1) continue;
    const periodStart = scheduling.addingWeeks(index * room.periodicity.intervalWeeks, room.calendarAnchor);
    const responsible = responsibleAt(lastWhere(room.scheduleVersions, (v) => v.effectiveAt <= periodStart), index);
    const already = new Set(
      state.notifications.filter((n) => n.kind === "cycleTurned" && n.roomID === room.id && n.createdAt >= periodStart).map((n) => n.recipientUserID),
    );
    const before = state.notifications.length;
    notifyAll(ctx, state, responsible.filter((id) => !already.has(id)), null, houseID, "cycleTurned", date, {
      roomID: room.id, subjectName: room.name,
    });
    created += state.notifications.length - before;
  }
  return created;
}

/**
 * "O resumo da semana está pronto": para cada morador que tem resultado liberado (`ratingSummary`) e ainda não foi
 * avisado deste ciclo. Um aviso por pessoa e ciclo. Devolve quantos avisos criou.
 */
export function emitWeeklySummary(ctx: CommandContext, state: StoreState, houseID: HouseID, date: Instant): number {
  let created = 0;
  for (const userID of houseResidentIDs(state, houseID)) {
    const results = ratingSummary(ctx, state, houseID, userID, date);
    if (results.length === 0) continue;
    const since = Math.min(...results.map((r) => r.periodEnd));
    if (state.notifications.some((n) => n.kind === "weeklySummaryReady" && n.recipientUserID === userID && n.createdAt >= since)) continue;
    notifyAll(ctx, state, [userID], null, houseID, "weeklySummaryReady", date);
    created += 1;
  }
  return created;
}
