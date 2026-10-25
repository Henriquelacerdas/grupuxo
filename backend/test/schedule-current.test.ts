import assert from "node:assert/strict";
import { test } from "node:test";
import { roomParticipation, roomScheduleReady } from "../src/domain/commands/rooms.ts";
import { completeTask, refreshSchedule, scheduleIsCurrent } from "../src/domain/commands/tasks.ts";
import { createCalendar } from "../src/domain/dates.ts";
import { isActiveAssignment, isCompleted } from "../src/domain/entities.ts";
import { cloneStoreState } from "../src/domain/store-state.ts";
import { World } from "./support/world.ts";

const SAO_PAULO = "America/Sao_Paulo";

// As consultas da `api` só gravam quando `scheduleIsCurrent` é falso: ele nunca pode ser verdadeiro quando o
// `refreshSchedule` mudaria o estado, senão a escala deixaria de ser estendida.
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
      assert.deepStrictEqual(copy, state, `dia ${day}: escala em dia, mas o refresh mudou o estado`);
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
