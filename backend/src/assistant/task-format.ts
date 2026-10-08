import { createCalendar, localDateTime, type Instant } from "../domain/dates.ts";
import { isCompleted, type TaskItem } from "../domain/entities.ts";
import type { RoomID } from "../domain/ids.ts";
import type { TaskRange } from "../domain/use-cases/tasks.ts";

// Texto das respostas, em português. Tudo o que aparece (nomes, datas, responsáveis) vem do que a ferramenta
// devolveu; o modelo não escreve nada disto. Esforço é carga interna e nunca é exibido.

export interface FormatContext {
  /** Fuso IANA da casa: as datas são mostradas nele, nunca em UTC. */
  readonly timezone: string;
  readonly now: Instant;
  /** Cômodos que o morador enxerga, para rotular as tarefas. */
  readonly roomNames: ReadonlyMap<RoomID, string>;
}

export const MAX_LISTED_TASKS = 20;
const MAX_NAME_CHARS = 60;
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] as const;

/** Nomes vêm de outros moradores: uma linha só, sem caracteres de controle, de tamanho limitado. */
export function displayText(text: string): string {
  const oneLine = text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
  const chars = Array.from(oneLine);
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…` : oneLine;
}

const two = (value: number): string => String(value).padStart(2, "0");

function dayLabel(instant: Instant, ctx: FormatContext): string {
  const calendar = createCalendar(ctx.timezone);
  const { year, month, day } = localDateTime(ctx.timezone, instant);
  const weekday = WEEKDAYS[calendar.isoWeekday(instant) - 1] ?? "";
  const currentYear = localDateTime(ctx.timezone, ctx.now).year;
  return `${weekday} ${two(day)}/${two(month)}${year === currentYear ? "" : `/${year}`}`;
}

function isMidnight(instant: Instant, timezone: string): boolean {
  const { hour, minute, second } = localDateTime(timezone, instant);
  return hour === 0 && minute === 0 && second === 0;
}

/**
 * O prazo é o fim exclusivo de `[availableAt, dueAt)`: um prazo à meia-noite significa "até o dia anterior"
 * (a semana que termina na segunda 00:00 vence no domingo). Com horário, mostra o horário.
 */
function deadlineLabel(dueAt: Instant, ctx: FormatContext): string {
  if (isMidnight(dueAt, ctx.timezone)) return `até ${dayLabel(createCalendar(ctx.timezone).addDays(dueAt, -1), ctx)}`;
  const { hour, minute } = localDateTime(ctx.timezone, dueAt);
  return `até ${dayLabel(dueAt, ctx)} ${two(hour)}:${two(minute)}`;
}

interface LineOptions {
  readonly showRoom: boolean;
  readonly showAssignee: boolean;
}

function line(item: TaskItem, ctx: FormatContext, options: LineOptions): string {
  const room = options.showRoom ? ctx.roomNames.get(item.definition.roomID) : undefined;
  const parts: string[] = [`• ${displayText(item.definition.name)}${room === undefined ? "" : ` (${displayText(room)})`}`];
  if (isCompleted(item.occurrence)) {
    const { completedAt } = item.occurrence;
    parts.push(completedAt === null ? "concluída" : `concluída em ${dayLabel(completedAt, ctx)}`);
  } else {
    const { dueAt } = item.occurrence;
    if (dueAt !== null) parts.push(deadlineLabel(dueAt, ctx) + (dueAt <= ctx.now ? " (atrasada)" : ""));
    if (options.showAssignee) parts.push(item.assignee === null ? "sem responsável" : `com ${displayText(item.assignee.name)}`);
  }
  return parts.join(" — ");
}

function lines(items: readonly TaskItem[], ctx: FormatContext, options: LineOptions): string[] {
  const shown = items.slice(0, MAX_LISTED_TASKS).map((item) => line(item, ctx, options));
  const hidden = items.length - shown.length;
  return hidden > 0 ? [...shown, `… e mais ${hidden}.`] : shown;
}

/** Pendentes primeiro; as concluídas vêm depois, sob o próprio título (os casos de uso já ordenam por prazo). */
function section(title: string, items: readonly TaskItem[], empty: string, ctx: FormatContext, options: LineOptions): string {
  if (items.length === 0) return empty;
  const pending = items.filter((item) => !isCompleted(item.occurrence));
  const done = items.filter((item) => isCompleted(item.occurrence));
  const blocks: string[] = [];
  if (pending.length > 0) blocks.push([title, ...lines(pending, ctx, options)].join("\n"));
  if (done.length > 0) blocks.push(["Concluídas:", ...lines(done, ctx, options)].join("\n"));
  return blocks.join("\n\n");
}

export function formatMyTasks(items: readonly TaskItem[], range: TaskRange, ctx: FormatContext): string {
  const scope = range === "week" ? " da semana" : "";
  return section(`Suas tarefas${scope}:`, items, `Você não tem tarefas${scope}.`, ctx, { showRoom: true, showAssignee: false });
}

export function formatRoomTasks(roomName: string, items: readonly TaskItem[], ctx: FormatContext): string {
  const name = displayText(roomName);
  return section(`Tarefas de ${name}:`, items, `Não há tarefas em ${name}.`, ctx, { showRoom: false, showAssignee: true });
}

export function formatSporadicTasks(items: readonly TaskItem[], ctx: FormatContext): string {
  return section("Tarefas avulsas:", items, "Não há tarefas avulsas.", ctx, { showRoom: true, showAssignee: true });
}
