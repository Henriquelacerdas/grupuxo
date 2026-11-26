import type { Arg, Locale } from "@/i18n/messages";
import type { Periodicity, Recurrence, Room, TaskDefinition, TaskItem } from "@/lib/api/types";
import { calendarDays, dayMonth, list, weekday } from "./dates";
import { shortName } from "./names";

// Textos de apresentação, portados de MyTasksText, HouseOverviewText e RoomDetailText do app (mesmas chaves do
// catálogo). Calendário no fuso da casa.

export type Translate = (key: string, ...args: Arg[]) => string;

export interface TextContext {
  readonly t: Translate;
  readonly locale: Locale;
  readonly timeZone: string;
}

const WEEKDAY_HORIZON = 7;

export interface CycleProgress { readonly completed: number; readonly total: number }

/** `end` é o fim exclusivo do ciclo: o último dia é o anterior. */
export function deadline(ctx: TextContext, cycleEnd: number, now: number): string {
  const lastDay = cycleEnd - 86_400_000;
  const days = Math.max(0, calendarDays(now, lastDay, ctx.timeZone));
  if (days === 0) return ctx.t("Termina hoje");
  if (days === 1) return ctx.t("Termina amanhã");
  if (days < WEEKDAY_HORIZON) return ctx.t("Termina {0}", weekday(lastDay, ctx.locale, ctx.timeZone));
  return ctx.t("Termina em {0} dias", days);
}

/** "Termina domingo · 2 de 5"; sem tarefas no ciclo, só o prazo. */
export function cycleStatus(ctx: TextContext, periodEnd: number, progress: CycleProgress, now: number): string {
  const text = deadline(ctx, periodEnd, now);
  return progress.total > 0 ? ctx.t("{0} · {1} de {2}", text, progress.completed, progress.total) : text;
}

export function progressText(ctx: TextContext, progress: CycleProgress): string {
  return progress.total === 0 ? ctx.t("Nenhuma tarefa neste ciclo") : ctx.t("{0} de {1} tarefas feitas", progress.completed, progress.total);
}

export type TimingStyle = "upcoming" | "open" | "due" | "overdue";
export interface TaskTiming { readonly text: string; readonly style: TimingStyle }

function relativeDay(ctx: TextContext, at: number, days: number): string {
  if (days === 1) return ctx.t("amanhã");
  if (days === -1) return ctx.t("ontem");
  if (Math.abs(days) <= WEEKDAY_HORIZON - 1) return weekday(at, ctx.locale, ctx.timeZone);
  return dayMonth(at, ctx.locale, ctx.timeZone);
}

/** "Começa terça", "Termina hoje", "Terminou ontem" (vencido, em vermelho só em Minhas tarefas). */
export function timing(ctx: TextContext, availableAt: number, dueAt: number | null, now: number): TaskTiming | null {
  const startDays = calendarDays(now, availableAt, ctx.timeZone);
  if (startDays > 0) return { text: ctx.t("Começa {0}", relativeDay(ctx, availableAt, startDays)), style: "upcoming" };
  if (dueAt === null) return null;
  // O prazo é exclusivo (meia-noite do dia seguinte ao último): o dia mostrado é o do último instante.
  const lastMoment = dueAt - 1000;
  const dueDays = calendarDays(now, lastMoment, ctx.timeZone);
  if (dueAt <= now) return { text: ctx.t("Terminou {0}", relativeDay(ctx, lastMoment, dueDays)), style: "overdue" };
  if (dueDays <= 0) return { text: ctx.t("Termina hoje"), style: "due" };
  return { text: ctx.t("Termina {0}", relativeDay(ctx, lastMoment, dueDays)), style: dueDays === 1 ? "due" : "open" };
}

export function pendingSwap(ctx: TextContext, receiverName: string | null): string {
  return receiverName === null || receiverName === "" ? ctx.t("Troca pedida") : ctx.t("Troca pedida · aguardando {0}", receiverName);
}

/** Leve, Médio, Intenso: o esforço é carga interna, nunca pontuação. */
export function effortName(t: Translate, effort: number): string {
  if (effort <= 1) return t("Leve");
  if (effort === 2) return t("Médio");
  return t("Intenso");
}

export function recurrenceText(t: Translate, recurrence: Recurrence): string | null {
  switch (recurrence.kind) {
    case "none": return null;
    case "weekly": return recurrence.periodicity.intervalWeeks === 1 ? t("Semanalmente") : t("A cada {0} semanas", recurrence.periodicity.intervalWeeks);
    case "recurring": {
      const { frequency, interval } = recurrence;
      if (interval === 1) {
        return { daily: t("Diariamente"), weekly: t("Semanalmente"), monthly: t("Mensalmente"), yearly: t("Anualmente") }[frequency];
      }
      return {
        daily: t("A cada {0} dias", interval), weekly: t("A cada {0} semanas", interval),
        monthly: t("A cada {0} meses", interval), yearly: t("A cada {0} anos", interval),
      }[frequency];
    }
  }
}

export function taskSubtitle(t: Translate, definition: TaskDefinition, includingRecurrence: boolean): string {
  const effort = effortName(t, definition.effort);
  const recurrence = includingRecurrence ? recurrenceText(t, definition.recurrence) : null;
  return recurrence === null ? effort : t("{0} · {1}", recurrence, effort);
}

export function cycleDuration(t: Translate, periodicity: Periodicity): string {
  if (periodicity.intervalWeeks === 1) return t("Semanalmente");
  if (periodicity.intervalWeeks === 4) return t("Mensalmente");
  return t("A cada {0} semanas", periodicity.intervalWeeks);
}

export function rotation(t: Translate, periodicity: Periodicity): string {
  if (periodicity.intervalWeeks === 1) return t("Rodízio semanal");
  if (periodicity.intervalWeeks === 4) return t("Rodízio mensal");
  return t("Rodízio a cada {0} semanas", periodicity.intervalWeeks);
}

export function participantsText(t: Translate, room: Room, memberCount: number): string {
  return room.visibility === "common" ? t("Todos • público") : t("{0} moradores • privado", memberCount);
}

export function singleTaskStatus(t: Translate, item: TaskItem, currentUserID: string): string {
  if (item.occurrence.status === "completed") return t("Concluída");
  if (item.assignment === null) return t("Ninguém pegou ainda");
  if (item.assignment.userID === currentUserID) return t("Com você");
  if (item.assignee !== null) return t("Com {0}", shortName(item.assignee.name));
  return t("Já tem responsável");
}

/** "Você e Gabriel M.": quem está logado vira "Você" e vem primeiro. Sem IDs, só os nomes curtos. */
export function responsibles(ctx: TextContext, names: readonly string[], userIDs: readonly string[], currentUserID: string): string | null {
  if (names.length === 0) return null;
  if (userIDs.length === 0) return list(names.map(shortName), ctx.locale);
  if (names.length !== userIDs.length) return null;
  const others = userIDs.flatMap((id, index) => (id === currentUserID ? [] : [shortName(names[index] ?? "")]));
  const listed = [...(userIDs.includes(currentUserID) ? [ctx.t("Você")] : []), ...others];
  return list(listed, ctx.locale);
}

/** "Você" para quem está logado; os demais em nome curto. */
export function personName(t: Translate, user: { readonly id: string; readonly name: string }, currentUserID: string): string {
  return user.id === currentUserID ? t("Você") : shortName(user.name);
}
