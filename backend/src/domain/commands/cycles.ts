import { lastWhere } from "../arrays.ts";
import { createCalendar, localDateTime, type Instant } from "../dates.ts";
import { isCompleted } from "../entities.ts";
import type { HouseID, UserID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";
import { houseResidentIDs, notifyAll } from "./notifications.ts";
import { ratingSummary, responsibleAt } from "./ratings.ts";
import { taskItems, userTasks } from "./tasks.ts";

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

/**
 * "Lembrete das tarefas": para o morador que tem tarefa sua disponível e ainda não feita, na hora que escolheu (hora de
 * parede no fuso da casa). `reminderHours` traz só quem quer o lembrete (`remindTasks`) e tem aparelho, com o horário
 * (0 a 23); as preferências moram fora da casa, então quem chama as lê. Um aviso por pessoa e dia (do fuso da casa):
 * repetir a chamada na mesma hora não duplica. Sem tarefa pendente não há aviso. Devolve quantos avisos criou.
 */
export function emitTaskReminders(
  ctx: CommandContext, state: StoreState, houseID: HouseID, date: Instant, reminderHours: ReadonlyMap<UserID, number>,
): number {
  const house = state.houses.find((h) => h.id === houseID);
  if (house === undefined || reminderHours.size === 0) return 0;
  const hour = localDateTime(house.timezone, date).hour;
  const dayStart = createCalendar(house.timezone).startOfDay(date);
  const items = taskItems(state);
  let created = 0;
  for (const userID of houseResidentIDs(state, houseID)) {
    if (reminderHours.get(userID) !== hour) continue;
    if (state.notifications.some((n) => n.kind === "taskReminder" && n.recipientUserID === userID && n.createdAt >= dayStart)) continue;
    const pending = userTasks(state, userID, houseID, date, items)
      .some((item) => !isCompleted(item.occurrence) && item.occurrence.availableAt <= date);
    if (!pending) continue;
    notifyAll(ctx, state, [userID], null, houseID, "taskReminder", date);
    created += 1;
  }
  return created;
}
