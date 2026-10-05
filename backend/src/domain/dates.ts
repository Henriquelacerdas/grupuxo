import { DomainError } from "./errors.ts";

/** Instante em milissegundos desde a época Unix (UTC). Imutável e comparável com `<`. */
export type Instant = number;

/** Mesmos valores de `Date.distantPast` e `Date.distantFuture` do Foundation (anos 0001 e 4001). */
export const DISTANT_PAST: Instant = -62_135_769_600_000;
export const DISTANT_FUTURE: Instant = 64_092_211_200_000;

const MAX_MS = 8.64e15;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Calendário gregoriano de um fuso IANA, com semana começando na segunda-feira.
 * Toda aritmética anda em dias do calendário local (nunca soma 24 h), como o `Calendar` do Foundation:
 * o horário de parede é preservado; horário inexistente (lacuna do horário de verão) usa o deslocamento
 * anterior à transição; horário repetido resolve para a primeira ocorrência.
 */
export interface Calendar {
  readonly timeZone: string;
  startOfDay(instant: Instant): Instant;
  /** Início (00:00 local, ou o primeiro instante do dia) da segunda-feira da semana de `instant`. */
  weekStart(instant: Instant): Instant;
  addDays(instant: Instant, count: number): Instant;
  addWeeks(instant: Instant, count: number): Instant;
  /** Dia do mês é limitado ao último dia do mês de destino (31/jan + 1 mês = 28/fev). */
  addMonths(instant: Instant, count: number): Instant;
  addYears(instant: Instant, count: number): Instant;
  /** Dias completos de calendário de `from` até `to` (como `dateComponents([.day], from:to:)`). */
  daysBetween(from: Instant, to: Instant): number;
  /** Semanas completas de `from` até `to` (como `dateComponents([.weekOfYear], from:to:)`). */
  weeksBetween(from: Instant, to: Instant): number;
  /** 1 = segunda ... 7 = domingo. */
  isoWeekday(instant: Instant): number;
}

interface LocalFields {
  readonly year: number;
  readonly month: number; // 1...12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/** Valor de `Date.UTC` sem o mapeamento de anos 0...99 para 1900...1999; aceita dia/mês fora da faixa. */
function civilToMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getTime();
}

function daysInMonth(year: number, month: number): number {
  return new Date(civilToMs(year, month + 1, 0)).getUTCDate();
}

function assertInRange(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MS) throw new DomainError("invalidDateInterval");
  return value;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function localFields(timeZone: string, instant: Instant): LocalFields {
  assertInRange(instant);
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = values;
  if (
    year === undefined || month === undefined || day === undefined ||
    hour === undefined || minute === undefined || second === undefined
  ) {
    throw new DomainError("invalidDateInterval");
  }
  return { year, month, day, hour, minute, second, millisecond: ((instant % 1000) + 1000) % 1000 };
}

/** Deslocamento (local - UTC) em ms vigente em `instant`. */
function offsetAt(timeZone: string, instant: Instant): number {
  const f = localFields(timeZone, instant);
  const wall = civilToMs(f.year, f.month, f.day, f.hour, f.minute, f.second, f.millisecond);
  return wall - instant;
}

/** Converte um horário de parede em instante, com as regras de lacuna e repetição descritas em `Calendar`. */
function resolveLocal(timeZone: string, wall: number): Instant {
  assertInRange(wall);
  const before = offsetAt(timeZone, wall - DAY);
  const after = offsetAt(timeZone, wall + DAY);
  let best: number | undefined;
  for (const offset of new Set([before, after])) {
    const candidate = wall - offset;
    if (offsetAt(timeZone, candidate) === offset && (best === undefined || candidate < best)) best = candidate;
  }
  return assertInRange(best ?? wall - before);
}

function wallOf(f: LocalFields): number {
  return civilToMs(f.year, f.month, f.day, f.hour, f.minute, f.second, f.millisecond);
}

function timeOfDay(f: LocalFields): number {
  return ((f.hour * 60 + f.minute) * 60 + f.second) * 1000 + f.millisecond;
}

export function createCalendar(timeZone: string): Calendar {
  try {
    formatter(timeZone).format(0);
  } catch {
    throw new DomainError("invalidDateInterval");
  }

  const startOfDay = (instant: Instant): Instant => {
    const f = localFields(timeZone, instant);
    return resolveLocal(timeZone, civilToMs(f.year, f.month, f.day));
  };

  const addDays = (instant: Instant, count: number): Instant => {
    if (!Number.isInteger(count)) throw new DomainError("invalidDateInterval");
    const f = localFields(timeZone, instant);
    return resolveLocal(timeZone, civilToMs(f.year, f.month, f.day + count, f.hour, f.minute, f.second, f.millisecond));
  };

  const addMonths = (instant: Instant, count: number): Instant => {
    if (!Number.isInteger(count)) throw new DomainError("invalidDateInterval");
    const f = localFields(timeZone, instant);
    const index = f.year * 12 + (f.month - 1) + count;
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    const day = Math.min(f.day, daysInMonth(year, month));
    return resolveLocal(timeZone, civilToMs(year, month, day, f.hour, f.minute, f.second, f.millisecond));
  };

  const isoWeekday = (instant: Instant): number => {
    const f = localFields(timeZone, instant);
    const sundayBased = new Date(civilToMs(f.year, f.month, f.day)).getUTCDay();
    return sundayBased === 0 ? 7 : sundayBased;
  };

  const daysBetween = (from: Instant, to: Instant): number => {
    const a = localFields(timeZone, from);
    const b = localFields(timeZone, to);
    const civil = Math.round((civilToMs(b.year, b.month, b.day) - civilToMs(a.year, a.month, a.day)) / DAY);
    // Só conta dias completos: o horário de parede de `to` ainda não alcançou o de `from`.
    if (civil > 0 && timeOfDay(b) < timeOfDay(a)) return civil - 1;
    if (civil < 0 && timeOfDay(b) > timeOfDay(a)) return civil + 1;
    return civil;
  };

  return {
    timeZone,
    startOfDay,
    weekStart(instant) {
      const f = localFields(timeZone, instant);
      const back = isoWeekday(instant) - 1;
      return resolveLocal(timeZone, civilToMs(f.year, f.month, f.day - back));
    },
    addDays,
    addWeeks: (instant, count) => addDays(instant, count * 7),
    addMonths,
    addYears: (instant, count) => addMonths(instant, count * 12),
    daysBetween,
    weeksBetween: (from, to) => Math.trunc(daysBetween(from, to) / 7),
    isoWeekday,
  };
}

/** Lê um instante ISO-8601 com fuso explícito (`Z` ou `±hh:mm`). Usado em testes e na borda. */
export function parseInstant(text: string): Instant {
  if (!/^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new DomainError("invalidDateInterval");
  }
  return assertInRange(Date.parse(text));
}

export function formatInstant(instant: Instant): string {
  return new Date(assertInRange(instant)).toISOString();
}

export interface LocalDateTime {
  readonly year: number;
  readonly month: number; // 1...12
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
}

/** Horário de parede de `instant` no fuso (extensão só do servidor, para exibir datas no fuso da casa; sem equivalente no Swift). */
export function localDateTime(timeZone: string, instant: Instant): Required<LocalDateTime> {
  createCalendar(timeZone);
  const { year, month, day, hour, minute, second } = localFields(timeZone, instant);
  return { year, month, day, hour, minute, second };
}

/** Instante de um horário de parede no fuso (lacuna usa o deslocamento anterior; repetição, a primeira ocorrência). */
export function localToInstant(timeZone: string, local: LocalDateTime): Instant {
  createCalendar(timeZone);
  return resolveLocal(timeZone, civilToMs(local.year, local.month, local.day, local.hour ?? 0, local.minute ?? 0, local.second ?? 0));
}
