import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCalendar, DISTANT_FUTURE, DISTANT_PAST, formatInstant, localDateTime, localToInstant, parseInstant,
} from "../src/domain/dates.ts";
import { isDomainError } from "../src/domain/errors.ts";

const iso = formatInstant;

test("a semana começa na segunda-feira, no fuso da casa (domingo 23:59 vs segunda 00:00)", () => {
  for (const [zone, offsetHours] of [["America/Sao_Paulo", -3], ["UTC", 0], ["Asia/Tokyo", 9]] as const) {
    const cal = createCalendar(zone);
    const sundayLate = localToInstant(zone, { year: 2026, month: 9, day: 20, hour: 23, minute: 59, second: 59 });
    const mondayStart = localToInstant(zone, { year: 2026, month: 9, day: 21 });
    assert.equal(mondayStart - sundayLate, 1000, zone);
    assert.equal(cal.weekStart(sundayLate), localToInstant(zone, { year: 2026, month: 9, day: 14 }), zone);
    assert.equal(cal.weekStart(mondayStart), mondayStart, zone);
    assert.equal(cal.isoWeekday(sundayLate), 7);
    assert.equal(cal.isoWeekday(mondayStart), 1);
    assert.equal(mondayStart, Date.UTC(2026, 8, 21) - offsetHours * 3_600_000);
  }
});

test("o mesmo instante cai em semanas diferentes em fusos diferentes", () => {
  const instant = parseInstant("2026-09-20T23:30:00-03:00"); // domingo à noite em São Paulo; segunda cedo em Tóquio
  assert.equal(createCalendar("America/Sao_Paulo").weekStart(instant), parseInstant("2026-09-14T00:00:00-03:00"));
  assert.equal(createCalendar("Asia/Tokyo").weekStart(instant), parseInstant("2026-09-21T00:00:00+09:00"));
});

test("dias locais não são 24 horas: março em Nova York tem 23 h, novembro 25 h", () => {
  const cal = createCalendar("America/New_York");
  const march7 = localToInstant("America/New_York", { year: 2026, month: 3, day: 7, hour: 12 });
  assert.equal(cal.addDays(march7, 1) - march7, 23 * 3_600_000);
  const oct31 = localToInstant("America/New_York", { year: 2026, month: 10, day: 31, hour: 12 });
  assert.equal(cal.addDays(oct31, 2) - oct31, 49 * 3_600_000);
  assert.equal(cal.addWeeks(localToInstant("America/New_York", { year: 2026, month: 10, day: 26 }), 1)
    - localToInstant("America/New_York", { year: 2026, month: 10, day: 26 }), 169 * 3_600_000);
});

test("horário inexistente usa o deslocamento anterior e o repetido, a primeira ocorrência", () => {
  const zone = "America/New_York";
  assert.equal(iso(localToInstant(zone, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 })), "2026-03-08T07:30:00.000Z"); // 03:30 EDT
  assert.equal(iso(localToInstant(zone, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 })), "2026-11-01T05:30:00.000Z"); // 01:30 EDT (1ª)
});

test("a meia-noite inexistente (São Paulo, 2018) começa o dia na primeira hora válida", () => {
  const cal = createCalendar("America/Sao_Paulo");
  const noon = localToInstant("America/Sao_Paulo", { year: 2018, month: 11, day: 4, hour: 12 });
  assert.equal(iso(cal.startOfDay(noon)), "2018-11-04T03:00:00.000Z"); // 01:00 local
});

test("meses limitam o dia ao último do mês de destino, inclusive em ano bissexto", () => {
  const cal = createCalendar("UTC");
  const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
  assert.equal(cal.addMonths(utc(2026, 1, 31), 1), utc(2026, 2, 28));
  assert.equal(cal.addMonths(utc(2024, 1, 31), 1), utc(2024, 2, 29));
  assert.equal(cal.addMonths(utc(2026, 12, 31), 2), utc(2027, 2, 28));
  assert.equal(cal.addYears(utc(2024, 2, 29), 1), utc(2025, 2, 28));
  assert.equal(cal.addMonths(utc(2026, 3, 15), -3), utc(2025, 12, 15));
});

test("daysBetween e weeksBetween contam períodos completos", () => {
  const cal = createCalendar("America/Sao_Paulo");
  const a = localToInstant("America/Sao_Paulo", { year: 2026, month: 9, day: 14 });
  assert.equal(cal.daysBetween(a, localToInstant("America/Sao_Paulo", { year: 2026, month: 9, day: 21 })), 7);
  assert.equal(cal.weeksBetween(a, localToInstant("America/Sao_Paulo", { year: 2026, month: 9, day: 27, hour: 23 })), 1);
  assert.equal(cal.weeksBetween(a, localToInstant("America/Sao_Paulo", { year: 2026, month: 9, day: 28 })), 2);
  assert.equal(cal.daysBetween(localToInstant("America/Sao_Paulo", { year: 2026, month: 9, day: 15 }), a), -1);
});

test("fuso desconhecido e datas fora do intervalo são erros de domínio", () => {
  assert.throws(() => createCalendar("Marte/Olympus"), (e: unknown) => isDomainError(e, "invalidDateInterval"));
  const cal = createCalendar("UTC");
  assert.throws(() => cal.addYears(Date.UTC(2026, 0, 1), 1_000_000), (e: unknown) => isDomainError(e, "invalidDateInterval"));
  assert.throws(() => cal.addDays(NaN, 1), (e: unknown) => isDomainError(e, "invalidDateInterval"));
  assert.throws(() => cal.addDays(Date.UTC(2026, 0, 1), 1.5), (e: unknown) => isDomainError(e, "invalidDateInterval"));
});

test("parseInstant exige fuso explícito e DISTANT_* ficam nos extremos", () => {
  assert.equal(parseInstant("2026-09-16T12:00:00Z"), Date.UTC(2026, 8, 16, 12));
  assert.equal(parseInstant("2026-09-16T09:00:00-03:00"), Date.UTC(2026, 8, 16, 12));
  assert.throws(() => parseInstant("2026-09-16T12:00:00"), (e: unknown) => isDomainError(e, "invalidDateInterval"));
  assert.throws(() => parseInstant("ontem"), (e: unknown) => isDomainError(e, "invalidDateInterval"));
  assert.ok(DISTANT_PAST < Date.UTC(1, 0, 1) && DISTANT_FUTURE > Date.UTC(4000, 0, 1));
});

test("localDateTime devolve o horário de parede no fuso, inclusive quando o dia UTC é outro", () => {
  const instant = parseInstant("2026-09-21T02:30:00Z"); // domingo 23:30 em São Paulo, segunda 11:30 em Tóquio
  assert.deepEqual(localDateTime("America/Sao_Paulo", instant), { year: 2026, month: 9, day: 20, hour: 23, minute: 30, second: 0 });
  assert.deepEqual(localDateTime("Asia/Tokyo", instant), { year: 2026, month: 9, day: 21, hour: 11, minute: 30, second: 0 });
  assert.equal(localToInstant("Asia/Tokyo", localDateTime("Asia/Tokyo", instant)), instant);
  assert.throws(() => localDateTime("Marte/Olympus", instant), (e: unknown) => isDomainError(e, "invalidDateInterval"));
});
