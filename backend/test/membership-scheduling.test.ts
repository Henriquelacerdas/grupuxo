import { at } from "../src/domain/arrays.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar, localToInstant } from "../src/domain/dates.ts";
import {
  createAbsence, isActiveAssignment, isCompleted, isCurrentMember, participatesAt, type SchedulingState, type TaskAssignment,
  type TaskOccurrence,
} from "../src/domain/entities.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { absenceID, taskOccurrenceID, userID, type UserID } from "../src/domain/ids.ts";
import { HouseQueueOptimizer, type QueueForecast } from "../src/domain/services/house-queue-optimizer.ts";
import { addCosts, costLess, HungarianAlgorithm, scheduleCost, ZERO_COST, type ScheduleCost } from "../src/domain/services/hungarian.ts";
import { addEffort, emptyWeeks, type ProjectedWeek } from "../src/domain/services/task-distribution-engine.ts";
import { WeeklyLoadCalculator } from "../src/domain/services/weekly-load.ts";
import { GetMyTasksUseCase, CompleteTaskUseCase, RemoveRoomMemberUseCase } from "../src/domain/use-cases/tasks.ts";
import { NO_RECURRENCE, recurring } from "../src/domain/value-objects.ts";
import { activeOwner, permutations, uuid, World } from "./support/world.ts";

const ZONE = "America/Sao_Paulo";
const date = localToInstant(ZONE, { year: 2026, month: 9, day: 16, hour: 12 });
const boundary = localToInstant(ZONE, { year: 2026, month: 9, day: 21 });
const calendar = createCalendar(ZONE);
const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);

function setup() {
  const world = new World({ timezone: ZONE });
  world.now = date;
  const { users, rooms, house } = world.seed;
  return { world, service: world.service(), state: world.cleanState(), users, rooms, house, definition: (roomID = rooms.kitchen.id, policy: "calendarRotation" | "afterCompletion" = "calendarRotation") =>
    world.definition(roomID, { policy }) };
}

function first<T>(items: readonly T[]): T {
  const value = items[0];
  assert.ok(value !== undefined);
  return value;
}

test("a conclusão pode ser desfeita sem duplicar esforço nem sucessoras", () => {
  for (const policy of ["calendarRotation", "afterCompletion"] as const) {
    const { service, state, definition } = setup();
    service.create(definition(undefined, policy), date, state);
    const original = first(state.occurrences);
    const owner = activeOwner(state, original);
    assert.ok(owner !== undefined);
    const debts = state.roomMemberships.map((m) => m.fairnessDebt);
    service.complete(original.id, owner, date, state);
    const completedDebts = state.roomMemberships.map((m) => m.fairnessDebt);
    const count = state.occurrences.length;
    assert.throws(() => service.reopen(original.id, userID(uuid(999)), state), code("taskUnavailable"));
    service.reopen(original.id, owner, state);
    assert.deepEqual(state.roomMemberships.map((m) => m.fairnessDebt), debts);
    assert.equal(first(state.occurrences).status, "assigned");
    assert.equal(first(state.occurrences).completedAt, null);
    assert.equal(first(state.occurrences).completedByUserID, null);
    assert.ok(state.assignments.some((a) => a.occurrenceID === original.id && a.userID === owner && isActiveAssignment(a)));
    service.complete(original.id, owner, date, state);
    assert.deepEqual(state.roomMemberships.map((m) => m.fairnessDebt), completedDebts);
    assert.equal(state.occurrences.length, count);
  }
});

test("minhas tarefas mantêm as concluídas por último e permitem desfazer", async () => {
  const { world, users, house } = setup();
  const env = world.env(world.seed.state);
  const user = users.marina.id;
  const getMyTasks = new GetMyTasksUseCase(env.tasks, env.houses, () => world.now);
  const complete = new CompleteTaskUseCase(env.tasks, () => world.now);
  const tasks = await getMyTasks.execute(user, house.id);
  const item = tasks.find((t) => !isCompleted(t.occurrence));
  assert.ok(item !== undefined);
  await complete.execute(item.occurrence.id, user);
  const completed = await getMyTasks.execute(user, house.id);
  const retained = completed.find((t) => t.occurrence.id === item.occurrence.id);
  assert.ok(retained !== undefined && isCompleted(retained.occurrence));
  const firstDone = completed.findIndex((t) => isCompleted(t.occurrence));
  assert.ok(completed.slice(firstDone).every((t) => isCompleted(t.occurrence)));
  await complete.execute(item.occurrence.id, user, { isCompleted: false });
  const reloaded = await env.tasks.tasks(user, house.id);
  assert.equal(reloaded.find((t) => t.occurrence.id === item.occurrence.id)?.occurrence.status === "completed", false);
  // Pelo cômodo: concluir e desfazer também funcionam, e o morador continua sendo o responsável.
  const roomID = item.definition.roomID;
  await complete.execute(item.occurrence.id, user);
  assert.ok(isCompleted((await env.tasks.roomTasks(roomID, user)).find((t) => t.occurrence.id === item.occurrence.id)?.occurrence ?? item.occurrence));
  await complete.execute(item.occurrence.id, user, { isCompleted: false });
  const roomTasks = await env.tasks.roomTasks(roomID, user);
  assert.equal(roomTasks.find((t) => t.occurrence.id === item.occurrence.id)?.occurrence.status === "completed", false);
});

test("a saída preserva a conclusão pendente e a reentrada mantém o saldo", () => {
  const { service, state, definition } = setup();
  const task = service.create(definition(), date, state);
  const original = first(state.occurrences);
  const owner = first(state.assignments).userID;
  service.removeMember(owner, task.roomID, date, state);
  assert.ok(!first(state.definitions).rotationQueue.includes(owner));
  const futureIDs = new Set(state.occurrences.filter((o) => o.availableAt >= boundary).map((o) => o.id));
  assert.ok(!state.assignments.some((a) => isActiveAssignment(a) && a.userID === owner && futureIDs.has(a.occurrenceID)));
  service.complete(original.id, owner, boundary, state);
  const member = state.roomMemberships.find((m) => m.roomID === task.roomID && m.userID === owner);
  assert.ok(member !== undefined);
  assert.equal(member.fairnessDebt, 2.25);
  service.addMember(owner, task.roomID, boundary, state);
  const rejoined = state.roomMemberships.find((m) => m.id === member.id);
  assert.ok(rejoined !== undefined);
  assert.ok(isCurrentMember(rejoined));
  assert.equal(rejoined.fairnessDebt, member.fairnessDebt);
  assert.ok(!participatesAt(rejoined, boundary));
  assert.ok(participatesAt(rejoined, calendar.addWeeks(boundary, 1)));
});

test("a última saída exige confirmação e exclui as tarefas", () => {
  const { service, state, definition, users, rooms } = setup();
  const user = users.marina.id;
  state.roomMemberships = state.roomMemberships.filter((m) => !(m.roomID === rooms.kitchen.id && m.userID !== user));
  service.create(definition(), date, state);
  assert.throws(() => service.removeMember(user, rooms.kitchen.id, date, state), code("deletionConfirmationRequired"));
  service.removeMember(user, rooms.kitchen.id, date, state, { confirmDeletion: true });
  assert.ok(state.definitions.length === 0 && state.occurrences.length === 0 && state.assignments.length === 0);
  assert.ok(!state.rooms.some((r) => r.id === rooms.kitchen.id));
});

test("a fila por conclusão muda na fronteira", () => {
  const { service, state, definition } = setup();
  const task = service.create(definition(undefined, "afterCompletion"), date, state);
  const owner = first(state.assignments).userID;
  service.removeMember(owner, task.roomID, date, state);
  assert.ok(first(state.definitions).rotationQueue.includes(owner));
  assert.equal(first(state.definitions).pendingRotation?.queue.includes(owner), false);
  service.complete(first(state.occurrences).id, owner, boundary, state);
  assert.notEqual(state.assignments.at(-1)?.userID, owner);
  assert.equal(state.occurrences.length, 2);
});

test("saída de cômodo privado expõe só as pendências preservadas", async () => {
  const { world, state, users, rooms, house, definition } = setup();
  const env = world.env(state);
  const task = await env.tasks.create(definition(rooms.privateOffice.id), users.marina.id, date);
  const owner = env.store.read((s) => first(s.assignments).userID);
  await new RemoveRoomMemberUseCase(env.tasks, () => world.now).execute(owner, task.roomID, { date });
  const visible = await env.tasks.roomTasks(task.roomID, owner);
  assert.equal(visible.length, 1);
  assert.equal(first(visible).assignment?.userID, owner);
  assert.ok((await env.rooms.rooms(house.id, owner)).some((r) => r.id === task.roomID));
  await env.tasks.complete(first(visible).occurrence.id, owner, boundary);
});

test("a virada de semana usa o calendário, inclusive no horário de verão", () => {
  const cases = [
    [ZONE, { year: 2026, month: 9, day: 20, hour: 23 }],
    [ZONE, { year: 2026, month: 9, day: 21, hour: 0 }],
    ["America/New_York", { year: 2026, month: 10, day: 26, hour: 0 }],
  ] as const;
  for (const [zone, components] of cases) {
    const cal = createCalendar(zone);
    const at = localToInstant(zone, components);
    const world = new World({ timezone: zone });
    const service = world.service(zone);
    const state = world.cleanState();
    service.create(world.definition(world.seed.rooms.kitchen.id), at, state);
    const owner = first(state.assignments).userID;
    service.removeMember(owner, world.seed.rooms.kitchen.id, at, state);
    const membership = state.roomMemberships.find((m) => m.roomID === world.seed.rooms.kitchen.id && m.userID === owner);
    const transition = membership?.rotationChanges?.at(-1);
    assert.ok(transition !== undefined);
    assert.ok(transition.effectiveAt > at);
    assert.equal(cal.isoWeekday(transition.effectiveAt), 1);
    assert.equal(cal.startOfDay(transition.effectiveAt), transition.effectiveAt);
    if (zone === "America/New_York") assert.equal(transition.effectiveAt - at, 169 * 3_600_000);
  }
});

test("comandos repetidos e concorrentes são idempotentes e desfazem estado inválido", async () => {
  const { world, state, definition, users } = setup();
  const env = world.env(state);
  const task = await env.tasks.create(definition(), users.marina.id, date);
  const rafa = users.rafa.id;
  await Promise.all(Array.from({ length: 5 }, () => env.tasks.removeMember(rafa, task.roomID, date, false)));
  const member = env.store.read((s) => s.roomMemberships.find((m) => m.roomID === task.roomID && m.userID === rafa));
  assert.ok(member !== undefined);
  assert.equal(member.rotationChanges?.length, 1);
  env.store.update((s) => {
    s.roomMemberships.push(member);
  });
  const before = env.store.read((s) => s);
  await assert.rejects(env.tasks.addMember(rafa, task.roomID, date), code("invalidDistribution"));
  const after = env.store.read((s) => s);
  assert.deepEqual(after.roomMemberships, before.roomMemberships);
  assert.deepEqual(after.assignments, before.assignments);
  assert.deepEqual(after.occurrences, before.occurrences);
});

test("snapshot, recorrência e ausência sobrevivem ao replanejamento", () => {
  const { world, service, state, definition, users } = setup();
  const task = { ...definition(), recurrence: recurring("weekly", 2) };
  service.create(task, date, state);
  const before = [...state.occurrences];
  state.definitions[0] = { ...first(state.definitions), effort: { points: 1 } };
  const membership = state.houseMemberships.find((m) => m.userID === users.marina.id);
  assert.ok(membership !== undefined);
  state.absences.push(createAbsence({
    id: absenceID(world.newID()), membershipID: membership.id, startsAt: boundary, endsAt: calendar.addWeeks(boundary, 20),
  }));
  service.removeMember(users.rafa.id, task.roomID, date, state);
  for (const old of before) {
    const next = state.occurrences.find((o) => o.id === old.id);
    assert.ok(next !== undefined);
    assert.equal(next.availableAt, old.availableAt);
    assert.equal(next.dueAt, old.dueAt);
    assert.deepEqual(next.effortSnapshot, old.effortSnapshot);
  }
  assert.ok(!state.assignments.some((a) => isActiveAssignment(a) && a.userID === users.marina.id && a.assignedAt >= boundary));
});

test("criação durante mudança pendente e inicialização de registros legados", () => {
  const { world, service, state, definition, users, rooms } = setup();
  service.removeMember(users.rafa.id, rooms.kitchen.id, date, state);
  const saved = service.create(definition(), date, state);
  assert.ok(!saved.rotationQueue.includes(users.rafa.id));
  const legacy = definition(rooms.bathroom.id);
  state.definitions.push(legacy);
  const old: TaskOccurrence = {
    id: taskOccurrenceID(world.newID()), taskDefinitionID: legacy.id, availableAt: date, dueAt: boundary, status: "available",
    completedAt: null, completedByUserID: null, completionDebtImpacts: null, didPublishSuccessor: null, effortSnapshot: legacy.effort,
  };
  state.occurrences.push(old);
  service.addMember(users.rafa.id, rooms.kitchen.id, date, state);
  assert.deepEqual(state.occurrences.find((o) => o.id === old.id), old);
  assert.notEqual(state.definitions.find((d) => d.id === legacy.id)?.nextScheduledAt, null);
  assert.ok(state.occurrences.some((o) => o.taskDefinitionID === legacy.id && o.availableAt === boundary));
});

test("quem entra pode assumir e concluir uma esporádica antes de a rotação começar", async () => {
  const { world, state, definition, users, rooms } = setup();
  const rafa = users.rafa.id;
  state.roomMemberships = state.roomMemberships.filter((m) => !(m.roomID === rooms.kitchen.id && m.userID === rafa));
  const env = world.env(state);
  const task = { ...definition(), kind: "sporadic" as const, recurrence: NO_RECURRENCE, assignmentPolicy: "selfAssigned" as const };
  await env.tasks.create(task, users.marina.id, date);
  await env.tasks.addMember(rafa, task.roomID, date);
  const occurrence = env.store.read((s) => first(s.occurrences));
  await env.tasks.claim(occurrence.id, rafa, date);
  await env.tasks.complete(occurrence.id, rafa, date);
  assert.ok(env.store.read((s) => isCompleted(first(s.occurrences))));
  assert.equal(env.store.read((s) => s.roomMemberships.find((m) => m.roomID === task.roomID && m.userID === rafa)?.fairnessDebt), 2.25);
});

test("mudança em um cômodo reequilibra os outros da casa", () => {
  const { service, state, definition, users, rooms } = setup();
  const everyone = [users.marina, users.leo, users.bia, users.rafa].map((u) => u.id);
  for (const room of [rooms.kitchen, rooms.bathroom, rooms.livingRoom, rooms.laundry]) {
    service.create(definition(room.id), date, state);
  }
  // Modela uma escala publicada válida, mas mal faseada: todo o trabalho pesado colide.
  state.definitions = state.definitions.map((d) => ({ ...d, rotationQueue: everyone, currentRotationIndex: 0 }));
  for (const d of state.definitions) {
    const occurrences = state.occurrences.filter((o) => o.taskDefinitionID === d.id).sort((a, b) => a.availableAt - b.availableAt);
    occurrences.forEach((occurrence, turn) => {
      const index = state.assignments.findIndex((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a));
      const old = state.assignments[index];
      assert.ok(old !== undefined);
      const replacement: TaskAssignment = {
        id: old.id, occurrenceID: old.occurrenceID, userID: at(everyone, turn % everyone.length),
        assignedAt: old.assignedAt, endedAt: null, supersededAt: null,
      };
      state.assignments[index] = replacement;
    });
  }
  const before: SchedulingState = { ...state, occurrences: [...state.occurrences], assignments: [...state.assignments] };
  service.removeMember(users.rafa.id, rooms.kitchen.id, date, state);
  const otherIDs = new Set(state.definitions.filter((d) => d.roomID !== rooms.kitchen.id).map((d) => d.id));
  const otherFuture = new Set(before.occurrences.filter((o) => otherIDs.has(o.taskDefinitionID) && o.availableAt >= boundary).map((o) => o.id));
  assert.ok(state.assignments.some((a) => otherFuture.has(a.occurrenceID) && a.supersededAt !== null));
  // Cálculo independente do esforço semanal, restrito às mesmas datas publicadas.
  const effortCost = (current: SchedulingState): number => {
    const loads = new Map<number, Map<UserID, number>>();
    for (const occurrence of before.occurrences.filter((o) => o.availableAt >= boundary)) {
      const owner = current.assignments.find((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a))?.userID;
      if (owner === undefined) continue;
      const perUser = loads.get(occurrence.availableAt) ?? new Map<UserID, number>();
      perUser.set(owner, (perUser.get(owner) ?? 0) + occurrence.effortSnapshot.points);
      loads.set(occurrence.availableAt, perUser);
    }
    let total = 0;
    for (const perUser of loads.values()) for (const value of perUser.values()) total += value * value;
    return total;
  };
  assert.ok(effortCost(state) < effortCost(before));
  assert.deepEqual(state.occurrences.filter((o) => o.availableAt < boundary), before.occurrences.filter((o) => o.availableAt < boundary));
});

test("a carga semanal conta o snapshot uma vez após reatribuição e conclusão", () => {
  const { service, state, definition, users, rooms } = setup();
  service.create(definition(), date, state);
  service.removeMember(users.rafa.id, rooms.kitchen.id, date, state);
  const next = state.occurrences.find((o) => o.availableAt === boundary);
  assert.ok(next !== undefined);
  const owner = activeOwner(state, next);
  assert.ok(owner !== undefined);
  const calculator = new WeeklyLoadCalculator();
  const pending = calculator.calculate(owner, state.assignments, state.occurrences, boundary, calendar);
  service.complete(next.id, owner, boundary, state);
  const completed = calculator.calculate(owner, state.assignments, state.occurrences, boundary, calendar);
  assert.equal(pending, completed);
  assert.equal(pending, 3);
});

function minimumCost(costs: readonly ScheduleCost[]): ScheduleCost {
  return costs.reduce((best, current) => (costLess(current, best) ? current : best));
}

test("o Húngaro lexicográfico coincide com o oráculo exaustivo", () => {
  for (let n = 1; n <= 6; n++) {
    for (let seed = 0; seed < 5; seed++) {
      const matrix = Array.from({ length: n }, (_, row) =>
        Array.from({ length: n }, (_, col) =>
          scheduleCost({
            effort: (row * 13 + col * seed + 5) % 9, difficulty: (row + col * 7) % 4, debt: row * col - seed,
            changes: row === col ? 0 : 1,
          })));
      const cost = (assignment: readonly number[]): ScheduleCost =>
        assignment.reduce<ScheduleCost>((sum, column, row) => addCosts(sum, matrix[row]?.[column] ?? ZERO_COST), ZERO_COST);
      const result = new HungarianAlgorithm().solveLexicographic(matrix);
      const oracle = minimumCost(permutations(Array.from({ length: n }, (_, i) => i)).map(cost));
      assert.deepEqual(cost(result), oracle);
    }
  }
});

test("a otimização da casa reduz picos semanais e é determinística", () => {
  const users = [1, 2, 3].map((n) => userID(uuid(n)));
  const turns = Array.from({ length: 12 }, (_, week) => ({
    week, effort: 3, eligible: new Set(users), incumbent: users[week % 3] ?? null, slot: null,
  }));
  const forecast: QueueForecast = { participants: users, turns, isFixed: false, existingQueue: users };
  const tasks = [forecast, forecast, forecast];
  const optimizer = new HouseQueueOptimizer();
  const result = optimizer.optimize(tasks, new Map(), new Map());
  const before = optimizer.score(tasks, [users, users, users], new Map(), new Map());
  const after = optimizer.score(tasks, result, new Map(), new Map());
  assert.ok(after.effort < before.effort);
  assert.equal(after.effort, 12 * 3 * 9);
  assert.deepEqual(optimizer.optimize(tasks, new Map(), new Map()), result);
  assert.ok(result.every((queue) => new Set(queue).size === users.length && queue.every((u) => users.includes(u))));
});

test("uma fila bate com todas as permutações dado o peso fixo da casa", () => {
  const users = [1, 2, 3, 4].map((n) => userID(uuid(n)));
  const weeks = emptyWeeks();
  for (let i = 0; i < 12; i += 4) weeks[i] = addEffort(at(weeks, i), 3);
  const fixed = new Map([[at(users, 0), weeks]]);
  const turns = Array.from({ length: 12 }, (_, week) => ({
    week, effort: (week % 3) + 1, eligible: new Set(users), incumbent: users[week % 4] ?? null, slot: null,
  }));
  const tasks: QueueForecast[] = [{ participants: users, turns, isFixed: false, existingQueue: users }];
  const optimizer = new HouseQueueOptimizer();
  const result = optimizer.optimize(tasks, fixed, new Map());
  const oracle = minimumCost(
    permutations(users.map((_, i) => i)).map((indices) =>
      optimizer.score(tasks, [indices.map((i) => at(users, i))], fixed, new Map())),
  );
  assert.deepEqual(optimizer.score(tasks, result, fixed, new Map()), oracle);
});
