import assert from "node:assert/strict";
import { test } from "node:test";
import { localToInstant, type Instant } from "../src/domain/dates.ts";
import { taskItem, type House, type TaskItem } from "../src/domain/entities.ts";
import {
  houseID, roomID, taskAssignmentID, taskDefinitionID, taskOccurrenceID, userID,
} from "../src/domain/ids.ts";
import { GetMyTasksUseCase } from "../src/domain/use-cases/tasks.ts";
import { NO_RECURRENCE, taskEffort, type TaskOccurrenceStatus } from "../src/domain/value-objects.ts";
import { uuid } from "./support/world.ts";

const me = userID(uuid(1));
const home = houseID(uuid(2));
let counter = 100;

function item(name: string, availableAt: Instant, dueAt: Instant | null, status: TaskOccurrenceStatus = "assigned", completedAt: Instant | null = null): TaskItem {
  const definitionID = taskDefinitionID(uuid(counter++));
  const occurrenceID = taskOccurrenceID(uuid(counter++));
  return taskItem(
    {
      id: definitionID, roomID: roomID(uuid(3)), name, details: "", effort: taskEffort(1), kind: "recurring",
      recurrence: NO_RECURRENCE, assignmentPolicy: "afterCompletion", sourceSuggestionID: null, rotationQueue: [],
      currentRotationIndex: 0, nextScheduledAt: null, pendingRotation: null, calendarAnchor: null,
    },
    {
      id: occurrenceID, taskDefinitionID: definitionID, availableAt, dueAt, status, completedAt,
      completedByUserID: completedAt === null ? null : me, completionDebtImpacts: null, didPublishSuccessor: null,
      effortSnapshot: taskEffort(1),
    },
    { id: taskAssignmentID(uuid(counter++)), occurrenceID, userID: me, assignedAt: availableAt, endedAt: null, supersededAt: null },
  );
}

function useCase(timezone: string, now: Instant, items: readonly TaskItem[]): GetMyTasksUseCase {
  const house: House = { id: home, name: "Casa", accessCode: "ABC123", createdAt: 0, timezone };
  return new GetMyTasksUseCase({ tasks: async () => [...items] }, { house: async () => house }, () => now);
}

const names = (tasks: readonly TaskItem[]) => tasks.map((t) => t.definition.name);
const local = (zone: string, year: number, month: number, day: number, hour = 0, minute = 0) =>
  localToInstant(zone, { year, month, day, hour, minute });

test("\"all\" é o padrão e não filtra nada", async () => {
  const zone = "America/Sao_Paulo";
  const items = [item("antiga", local(zone, 2026, 8, 3), local(zone, 2026, 8, 10)), item("atual", local(zone, 2026, 9, 14), local(zone, 2026, 9, 21))];
  const result = await useCase(zone, local(zone, 2026, 9, 16, 12), items).execute(me, home);
  assert.deepEqual(names(result), ["antiga", "atual"]);
});

test("a semana é a corrente da casa; atrasadas de semanas anteriores ficam fora", async () => {
  const zone = "America/Sao_Paulo";
  const items = [
    item("atrasada", local(zone, 2026, 9, 7), local(zone, 2026, 9, 14)),
    item("desta semana", local(zone, 2026, 9, 14), local(zone, 2026, 9, 21)),
    item("diária", local(zone, 2026, 9, 16), local(zone, 2026, 9, 17)),
  ];
  const result = await useCase(zone, local(zone, 2026, 9, 16, 12), items).execute(me, home, "week");
  assert.deepEqual(names(result), ["diária", "desta semana"]);
});

test("prazo exatamente na virada pertence à semana anterior; disponível na virada, à nova", async () => {
  const zone = "America/Sao_Paulo";
  const monday = local(zone, 2026, 9, 14);
  const items = [
    item("terminou na virada", local(zone, 2026, 9, 7), monday),
    item("um instante depois", local(zone, 2026, 9, 7), monday + 1),
    item("começa na virada", monday, local(zone, 2026, 9, 15)),
  ];
  const result = await useCase(zone, monday, items).execute(me, home, "week");
  // Ordenadas por prazo: o que termina um instante após a virada vem antes do que termina na terça.
  assert.deepEqual(names(result), ["um instante depois", "começa na virada"]);
});

test("domingo 23:59 ainda é a semana que acaba; segunda 00:00 já é a seguinte", async () => {
  const zone = "America/Sao_Paulo";
  const week1 = item("semana 1", local(zone, 2026, 9, 14), local(zone, 2026, 9, 21));
  const week2 = item("semana 2", local(zone, 2026, 9, 21), local(zone, 2026, 9, 28));
  const items = [week1, week2];
  const sundayNight = local(zone, 2026, 9, 20, 23, 59);
  assert.deepEqual(names(await useCase(zone, sundayNight, items).execute(me, home, "week")), ["semana 1"]);
  assert.deepEqual(names(await useCase(zone, sundayNight + 60_000, items).execute(me, home, "week")), ["semana 2"]);
});

test("a virada usa o fuso da casa, não o UTC", async () => {
  // Domingo 21:30 em São Paulo já é segunda 00:30 em UTC: para a casa ainda é a semana anterior.
  const zone = "America/Sao_Paulo";
  const instant = local(zone, 2026, 9, 20, 21, 30);
  const items = [item("semana 1", local(zone, 2026, 9, 14), local(zone, 2026, 9, 21)), item("semana 2", local(zone, 2026, 9, 21), local(zone, 2026, 9, 28))];
  assert.equal(new Date(instant).getUTCDay(), 1);
  assert.deepEqual(names(await useCase(zone, instant, items).execute(me, home, "week")), ["semana 1"]);
  // Segunda 00:30 em Tóquio é domingo 15:30 em UTC: para a casa já é a semana nova.
  const tokyo = "Asia/Tokyo";
  const tokyoInstant = local(tokyo, 2026, 9, 21, 0, 30);
  assert.equal(new Date(tokyoInstant).getUTCDay(), 0);
  const tokyoItems = [item("semana 1", local(tokyo, 2026, 9, 14), local(tokyo, 2026, 9, 21)), item("semana 2", local(tokyo, 2026, 9, 21), local(tokyo, 2026, 9, 28))];
  assert.deepEqual(names(await useCase(tokyo, tokyoInstant, tokyoItems).execute(me, home, "week")), ["semana 2"]);
});

test("horário de verão: a semana tem 167 h ou 169 h, não 168", async () => {
  const zone = "America/New_York";
  // Início do verão em 08/03/2026 (domingo): a semana de 02/03 tem 167 h; a seguinte começa 00:00 local de 09/03.
  const start = local(zone, 2026, 3, 2);
  const end = local(zone, 2026, 3, 9);
  assert.equal((end - start) / 3_600_000, 167);
  const items = [item("termina na virada", start, end), item("seguinte", end, local(zone, 2026, 3, 16))];
  assert.deepEqual(names(await useCase(zone, end - 1, items).execute(me, home, "week")), ["termina na virada"]);
  assert.deepEqual(names(await useCase(zone, end, items).execute(me, home, "week")), ["seguinte"]);
  // Fim do verão em 01/11/2026: a semana de 26/10 tem 169 h.
  const fallStart = local(zone, 2026, 10, 26);
  const fallEnd = local(zone, 2026, 11, 2);
  assert.equal((fallEnd - fallStart) / 3_600_000, 169);
  const fall = [item("outubro", fallStart, fallEnd), item("novembro", fallEnd, local(zone, 2026, 11, 9))];
  assert.deepEqual(names(await useCase(zone, fallEnd - 1, fall).execute(me, home, "week")), ["outubro"]);
  assert.deepEqual(names(await useCase(zone, fallEnd, fall).execute(me, home, "week")), ["novembro"]);
});

test("meia-noite inexistente (São Paulo, 2018): a semana começa na primeira hora válida", async () => {
  const zone = "America/Sao_Paulo";
  // Em 04/11/2018 (domingo) a meia-noite não existiu; segunda 05/11 é normal. Usar a semana de 29/10 a 05/11.
  const start = local(zone, 2018, 10, 29);
  const end = local(zone, 2018, 11, 5);
  const items = [item("semana", start, end), item("próxima", end, local(zone, 2018, 11, 12))];
  assert.deepEqual(names(await useCase(zone, local(zone, 2018, 11, 4, 12), items).execute(me, home, "week")), ["semana"]);
  assert.deepEqual(names(await useCase(zone, end, items).execute(me, home, "week")), ["próxima"]);
});

test("sem prazo: pendente fica aberta; concluída só conta na semana em que foi concluída", async () => {
  const zone = "America/Sao_Paulo";
  const now = local(zone, 2026, 9, 16, 12);
  const items = [
    item("pendente antiga", local(zone, 2026, 6, 1), null),
    item("concluída nesta semana", local(zone, 2026, 9, 1), null, "completed", local(zone, 2026, 9, 15)),
    item("concluída antes", local(zone, 2026, 9, 1), null, "completed", local(zone, 2026, 9, 10)),
  ];
  const result = await useCase(zone, now, items).execute(me, home, "week");
  assert.deepEqual(names(result), ["pendente antiga", "concluída nesta semana"]);
});

test("concluída com prazo na semana continua listada, depois das pendentes", async () => {
  const zone = "America/Sao_Paulo";
  const now = local(zone, 2026, 9, 16, 12);
  const items = [
    item("feita", local(zone, 2026, 9, 14), local(zone, 2026, 9, 16), "completed", local(zone, 2026, 9, 15)),
    item("pendente", local(zone, 2026, 9, 14), local(zone, 2026, 9, 21)),
  ];
  assert.deepEqual(names(await useCase(zone, now, items).execute(me, home, "week")), ["pendente", "feita"]);
});

test("fuso inválido na casa falha em vez de chutar", async () => {
  await assert.rejects(useCase("Marte/Olympus", 0, []).execute(me, home, "week"));
});
