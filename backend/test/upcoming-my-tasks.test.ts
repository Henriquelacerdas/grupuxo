import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar, localToInstant } from "../src/domain/dates.ts";
import { userTasks } from "../src/domain/commands/tasks.ts";
import { isActiveAssignment } from "../src/domain/entities.ts";
import { recurring } from "../src/domain/value-objects.ts";
import { World } from "./support/world.ts";

const ZONE = "America/Sao_Paulo";
// Quarta-feira 16/09/2026 ao meio-dia: a semana corrente termina na segunda 21/09 00:00.
const wednesday = localToInstant(ZONE, { year: 2026, month: 9, day: 16, hour: 12 });
const nextMonday = localToInstant(ZONE, { year: 2026, month: 9, day: 21 });

test("minhas tarefas trazem a vez da semana que ainda não começou, e só dela", () => {
  const world = new World({ timezone: ZONE });
  world.now = wednesday;
  const { rooms, house } = world.seed;
  const service = world.service();
  const state = world.cleanState();
  service.create(world.definition(rooms.kitchen.id, { recurrence: recurring("daily", 1) }), wednesday, state);

  const future = state.occurrences.filter((o) => o.availableAt > wednesday);
  assert.ok(future.length > 0, "a escala publica a próxima vez de cada morador, inclusive as futuras");

  const seen = new Set<string>();
  for (const member of state.houseMemberships.filter((m) => m.houseID === house.id)) {
    for (const item of userTasks(state, member.userID, house.id, wednesday)) {
      assert.equal(item.assignment?.userID, member.userID, "nunca a tarefa de outra pessoa");
      assert.ok(item.occurrence.availableAt < nextMonday, "só até o fim da semana corrente");
      seen.add(item.occurrence.id);
    }
  }

  for (const occurrence of future) {
    const assigned = state.assignments.some((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a));
    const inWeek = occurrence.availableAt < nextMonday;
    assert.equal(seen.has(occurrence.id), assigned && inWeek, "futura da semana aparece; a da semana seguinte não");
  }
  assert.ok([...future].some((o) => seen.has(o.id) && o.availableAt > wednesday), "pelo menos uma vez futura da semana aparece");
});

test("a vez futura aparece mas ainda não pode ser concluída", () => {
  const world = new World({ timezone: ZONE });
  world.now = wednesday;
  const { rooms } = world.seed;
  const service = world.service();
  const state = world.cleanState();
  service.create(world.definition(rooms.kitchen.id, { recurrence: recurring("daily", 1) }), wednesday, state);
  const calendar = createCalendar(ZONE);
  const upcoming = state.occurrences.find((o) =>
    o.availableAt > wednesday && o.availableAt < calendar.addWeeks(calendar.weekStart(wednesday), 1) &&
    state.assignments.some((a) => a.occurrenceID === o.id && isActiveAssignment(a)));
  assert.ok(upcoming !== undefined);
  const owner = state.assignments.find((a) => a.occurrenceID === upcoming.id && isActiveAssignment(a))?.userID;
  assert.ok(owner !== undefined);
  assert.throws(() => service.complete(upcoming.id, owner, wednesday, state));
});
