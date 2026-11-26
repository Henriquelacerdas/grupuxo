import type { Locale } from "@/i18n/messages";

// Calendário no fuso da casa (o mesmo que o servidor usa para ciclos e semanas). Instantes em milissegundos.

const DAY_MS = 86_400_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function ymd(at: number, timeZone: string): { y: number; m: number; d: number } {
  let formatter = partsCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
    partsCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Dias de calendário entre o dia de `from` e o dia de `to` no fuso (negativo no passado). */
export function calendarDays(from: number, to: number, timeZone: string): number {
  const a = ymd(from, timeZone);
  const b = ymd(to, timeZone);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** "domingo", "segunda": em português sem o "-feira" (o design usa "Termina segunda"). */
export function weekday(at: number, locale: Locale, timeZone: string): string {
  const name = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(at);
  return locale === "pt-BR" ? name.replace("-feira", "") : name;
}

export function dayMonth(at: number, locale: Locale, timeZone: string, month: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month, timeZone }).format(at).replace(".", "");
}

export function time(at: number, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}

export function fullDate(at: number, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone }).format(at);
}

/** Lista no idioma: "Você e Julia C.", "Ana, Bia e Caio". */
export function list(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** Início (segunda 00:00 no fuso) da semana de `at`: a "semana corrente" do servidor. */
export function weekStart(at: number, timeZone: string): number {
  const { y, m, d } = ymd(at, timeZone);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  return zonedMidnight(Date.UTC(y, m - 1, d - mondayOffset), timeZone);
}

/** Deslocamento do fuso em `at`: hora local lida como UTC menos o instante. */
function offset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at / 1000) * 1000;
}

/** Instante da meia-noite local do dia `utcDay` (meia-noite UTC daquele dia de calendário) no fuso. */
export function zonedMidnight(utcDay: number, timeZone: string): number {
  const first = utcDay - offset(utcDay, timeZone);
  return utcDay - offset(first, timeZone);
}
