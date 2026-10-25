import assert from "node:assert/strict";
import { test } from "node:test";
import { roomParticipation, roomScheduleReady } from "../src/domain/commands/rooms.ts";
import { completeTask, refreshSchedule, scheduleIsCurrent } from "../src/domain/commands/tasks.ts";
import { createCalendar } from "../src/domain/dates.ts";
import { isActiveAssignment, isCompleted } from "../src/domain/entities.ts";
import { cloneStoreState, type StoreState } from "../src/domain/store-state.ts";
import { weeklyPeriodicity } from "../src/domain/value-objects.ts";
import { World } from "./support/world.ts";

const SAO_PAULO = "America/Sao_Paulo";

/**
 * O estado sem o cursor das definições (`nextScheduledAt`, posição, fila e troca pendente). O cursor não sai na `api`
 * e andar com ele sem publicar nada não muda nenhuma resposta: ele fica para a próxima escrita.
 */
function withoutCursors(state: StoreState): unknown {
  return {
    ...state,
    definitions: state.definitions.map(({ nextScheduledAt: _n, currentRotationIndex: _i, rotationQueue: _q, pendingRotation: _p, ...rest }) => rest),
  };
}

// As consultas da `api` só gravam quando `scheduleIsCurrent` é falso: ele nunca pode ser verdadeiro quando o
// `refreshSchedule` publicaria ou removeria algo, senão a próxima vez de alguém deixaria de sair.
test("escala em dia: refreshSchedule não muda nada; depois dele a escala fica em dia", () => {
  const world = new World({ timezone: SAO_PAULO });
  const calendar = createCalendar(SAO_PAULO);
  const houseID = world.seed.house.id;
  const state = cloneStoreState(world.seed.state);
  const start = world.now;
  let current = 0;
  let stale = 0;

  for (let day = 0; day < 120; day++) {
    // Horas diferentes a cada dia (instante, não dia local): pega a virada da semana em horários variados.
    const date = calendar.addDays(start, day) + (day % 24) * 3_600_000;
    world.now = date;
    if (scheduleIsCurrent(world.ctx, state, houseID, date)) {
      current += 1;
      const copy = cloneStoreState(state);
      refreshSchedule(world.ctx, copy, houseID, date);
      assert.deepStrictEqual(withoutCursors(copy), withoutCursors(state), `dia ${day}: escala em dia, mas o refresh mudou o estado`);
    } else {
      stale += 1;
    }
    refreshSchedule(world.ctx, state, houseID, date);
    assert.ok(scheduleIsCurrent(world.ctx, state, houseID, date), `dia ${day}: refresh não deixou a escala em dia`);

    // Conclusões publicam sucessoras (inclusive de "afterCompletion") e mudam o que o refresh tem a fazer.
    if (day % 3 === 0) {
      const due = state.occurrences.find((o) => !isCompleted(o) && o.availableAt <= date);
      const owner = due && state.assignments.find((a) => a.occurrenceID === due.id && isActiveAssignment(a));
      if (due !== undefined && owner !== undefined) completeTask(world.ctx, state, due.id, owner.userID, date);
    }
  }
  assert.ok(current > 0 && stale > 0, `o cenário precisa passar pelos dois casos (em dia ${current}, desatualizada ${stale})`);
});

test("cômodo sem escala inicializada não está pronto para a consulta de participação", () => {
  const world = new World({ timezone: SAO_PAULO });
  const state = world.cleanState();
  const { rooms, users } = world.seed;
  assert.equal(roomScheduleReady(world.ctx, state, rooms.kitchen.id), false);
  assert.equal(scheduleIsCurrent(world.ctx, state, world.seed.house.id, world.now), false);

  roomParticipation(world.ctx, state, rooms.kitchen.id, users.marina.id, world.now);
  assert.equal(roomScheduleReady(world.ctx, state, rooms.kitchen.id), true);
  const copy = cloneStoreState(state);
  roomParticipation(world.ctx, copy, rooms.kitchen.id, users.marina.id, world.now);
  assert.deepStrictEqual(copy, state);
});

test("periodicidade própria: sem conclusão nada sai, e o cursor parado não obriga a gravar", () => {
  const world = new World({ timezone: SAO_PAULO });
  const calendar = createCalendar(SAO_PAULO);
  const state = world.cleanState();
  const houseID = world.seed.house.id;
  world.service().create(world.definition(world.seed.rooms.kitchen.id), world.now, state);
  const later = calendar.addWeeks(world.now, 3);
  assert.equal(scheduleIsCurrent(world.ctx, state, houseID, later), true);
  const copy = cloneStoreState(state);
  refreshSchedule(world.ctx, copy, houseID, later);
  assert.deepStrictEqual(copy.occurrences, state.occurrences);
  assert.deepStrictEqual(copy.assignments, state.assignments);
  assert.notEqual(copy.definitions[0]?.nextScheduledAt, state.definitions[0]?.nextScheduledAt);
});

test("escala do cômodo: a vez que atrasa faz a consulta gravar a próxima de quem atrasou", () => {
  const world = new World({ timezone: SAO_PAULO });
  const calendar = createCalendar(SAO_PAULO);
  const state = world.cleanState(weeklyPeriodicity(1, 1));
  const houseID = world.seed.house.id;
  world.service().create(world.definition(world.seed.rooms.kitchen.id), world.now, state);
  const current = state.occurrences.find((o) => o.availableAt <= world.now);
  assert.ok(current !== undefined && current.dueAt !== null);
  const owner = state.assignments.find((a) => a.occurrenceID === current.id && isActiveAssignment(a))?.userID;
  assert.ok(owner !== undefined);
  assert.equal(scheduleIsCurrent(world.ctx, state, houseID, current.dueAt - 1), true);
  assert.equal(scheduleIsCurrent(world.ctx, state, houseID, current.dueAt), false);
  const count = state.occurrences.length;
  refreshSchedule(world.ctx, state, houseID, current.dueAt);
  assert.equal(state.occurrences.length, count + 1);
  const next = state.occurrences.at(-1);
  assert.ok(next !== undefined && next.availableAt > current.dueAt);
  assert.equal(state.assignments.find((a) => a.occurrenceID === next.id && isActiveAssignment(a))?.userID, owner);
  assert.equal(scheduleIsCurrent(world.ctx, state, houseID, current.dueAt), true);
  assert.ok(calendar.weeksBetween(current.availableAt, next.availableAt) >= 1);
});
