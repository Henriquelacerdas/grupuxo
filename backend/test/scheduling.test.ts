import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar, DISTANT_PAST } from "../src/domain/dates.ts";
import {
  createAbsence, isActiveAssignment, isCompleted, type RoomMembership, type SchedulingState,
} from "../src/domain/entities.ts";
import { isDomainError, DomainError } from "../src/domain/errors.ts";
import { absenceID, roomMembershipID, taskOccurrenceID, userID } from "../src/domain/ids.ts";
import { GetHouseMembersUseCase } from "../src/domain/use-cases/houses-and-rooms.ts";
import {
  AddRoomMemberUseCase, CompleteTaskUseCase, CreateTaskUseCase, GetRoomTasksUseCase,
} from "../src/domain/use-cases/tasks.ts";
import { NO_RECURRENCE, recurring } from "../src/domain/value-objects.ts";
import { activeOwner, uuid, World } from "./support/world.ts";

const DATE = 1_789_344_000_000; // Referência determinística, nunca o relógio real.
const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);

function fixture(timezone = "UTC") {
  const world = new World({ timezone });
  world.now = DATE;
  const state = world.cleanState();
  const env = world.env(state);
  const marina = world.seed.users.marina;
  const kitchen = world.seed.rooms.kitchen;
  const definition = world.definition(kitchen.id);
  const schedule = (): SchedulingState => env.store.read((s) => s);
  return { world, env, marina, kitchen, definition, schedule, calendar: createCalendar(timezone) };
}

test("cria 12 semanas e o refresh não duplica", async () => {
  const { world, env, marina, definition, schedule, calendar } = fixture();
  const created = await new CreateTaskUseCase(env.tasks, () => world.now).execute(definition, marina.id, DATE);
  const initial = schedule();
  assert.equal(initial.occurrences.length, 12);
  assert.equal(initial.assignments.length, 12);
  assert.equal(new Set(created.rotationQueue).size, 4);
  assert.equal(created.currentRotationIndex, 0);
  assert.equal(initial.occurrences[0]?.availableAt, DATE);
  assert.ok(initial.occurrences.slice(1).every((o) => calendar.isoWeekday(o.availableAt) === 1));
  const future = calendar.addWeeks(DATE, 5);
  await env.tasks.refreshSchedule(world.seed.house.id, future);
  await env.tasks.refreshSchedule(world.seed.house.id, future);
  const final = schedule();
  assert.equal(final.occurrences.length, 17);
  assert.equal(final.assignments.length, 17);
  assert.deepEqual(final.occurrences.slice(0, 12), initial.occurrences);
  assert.equal(new Set(final.occurrences.map((o) => o.availableAt)).size, 17);
  assert.equal(final.definitions[0]?.currentRotationIndex, 1);
  assert.deepEqual(await env.tasks.create(definition, marina.id, future), final.definitions[0]);
});

test("intervalos semanais 2 e 20", async () => {
  for (const [interval, count] of [[2, 6], [20, 1]] as const) {
    const { env, marina, definition, schedule } = fixture();
    await env.tasks.create({ ...definition, recurrence: recurring("weekly", interval) }, marina.id, DATE);
    assert.equal(schedule().occurrences.length, count);
  }
});

test("agenda recorrências diárias, mensais e anuais", async () => {
  const daily = fixture();
  await daily.env.tasks.create({ ...daily.definition, recurrence: recurring("daily", 2) }, daily.marina.id, DATE);
  assert.equal(daily.schedule().occurrences[1]?.availableAt, daily.calendar.addDays(DATE, 2));

  const monthly = fixture();
  const savedMonthly = await monthly.env.tasks.create(
    { ...monthly.definition, recurrence: recurring("monthly", 3) }, monthly.marina.id, DATE,
  );
  assert.equal(monthly.schedule().occurrences.length, 1); // Três meses excedem o horizonte de 12 semanas.
  assert.equal(savedMonthly.nextScheduledAt, monthly.calendar.addMonths(DATE, 3));

  const yearly = fixture();
  const savedYearly = await yearly.env.tasks.create(
    { ...yearly.definition, recurrence: recurring("yearly", 1) }, yearly.marina.id, DATE,
  );
  assert.equal(savedYearly.nextScheduledAt, yearly.calendar.addYears(DATE, 1));
});

test("conclusão concorrente é atômica e usa o snapshot", async () => {
  const { env, marina, definition, schedule } = fixture();
  await env.tasks.create(definition, marina.id, DATE);
  const first = schedule().assignments[0];
  assert.ok(first !== undefined);
  env.store.update((s) => {
    const current = s.definitions[0];
    if (current !== undefined) s.definitions[0] = { ...current, effort: { points: 1 } };
  });
  await Promise.all(Array.from({ length: 20 }, () => env.tasks.complete(first.occurrenceID, first.userID, DATE)));
  const state = schedule();
  const memberships = state.roomMemberships.filter((m) => m.roomID === definition.roomID);
  assert.equal(memberships.find((m) => m.userID === first.userID)?.fairnessDebt, 2.25);
  assert.ok(memberships.filter((m) => m.userID !== first.userID).every((m) => m.fairnessDebt === -0.75));
  assert.ok(state.roomMemberships.filter((m) => m.roomID !== definition.roomID).every((m) => m.fairnessDebt === 0));
  assert.equal(state.occurrences.filter(isCompleted).length, 1);
  assert.equal(state.assignments.filter((a) => a.occurrenceID === first.occurrenceID && isActiveAssignment(a)).length, 0);
  assert.equal(state.definitions[0]?.currentRotationIndex, 0); // O cursor do calendário não avança na conclusão.
});

test("conclusões não autorizadas e futuras não alteram nada", async () => {
  const { env, marina, definition, schedule } = fixture();
  await env.tasks.create(definition, marina.id, DATE);
  const before = schedule();
  const first = before.assignments[0];
  const future = before.assignments[1];
  assert.ok(first !== undefined && future !== undefined);
  await assert.rejects(env.tasks.complete(first.occurrenceID, userID(uuid(999)), DATE), code("taskUnavailable"));
  await assert.rejects(env.tasks.complete(future.occurrenceID, future.userID, DATE), code("taskUnavailable"));
  const after = schedule();
  assert.deepEqual(after.occurrences, before.occurrences);
  assert.deepEqual(after.roomMemberships, before.roomMemberships);
  assert.deepEqual(after.assignments, before.assignments);
});

test("a transação desfaz as mutações feitas antes do erro", () => {
  const { env } = fixture();
  const before = env.store.read((s) => s.roomMemberships);
  assert.throws(() =>
    env.store.update((s) => {
      const first = s.roomMemberships[0];
      if (first !== undefined) s.roomMemberships[0] = { ...first, fairnessDebt: 123 };
      s.occurrences = [];
      throw new DomainError("invalidDistribution");
    }), code("invalidDistribution"));
  assert.deepEqual(env.store.read((s) => s.roomMemberships), before);
});

test("por conclusão publica apenas uma sucessora", async () => {
  const { world, env, marina, definition, schedule } = fixture();
  const saved = await env.tasks.create({ ...definition, assignmentPolicy: "afterCompletion" }, marina.id, DATE);
  const initial = schedule();
  assert.equal(initial.occurrences.length, 1);
  assert.deepEqual(saved.recurrence, NO_RECURRENCE);
  assert.equal(saved.currentRotationIndex, 1);
  const first = initial.assignments[0];
  assert.ok(first !== undefined);
  await new CompleteTaskUseCase(env.tasks, () => world.now).execute(first.occurrenceID, first.userID, { date: DATE });
  await env.tasks.complete(first.occurrenceID, first.userID, DATE);
  const final = schedule();
  assert.equal(final.occurrences.length, 2);
  assert.equal(final.occurrences.filter((o) => !isCompleted(o)).length, 1);
  assert.equal(final.assignments.at(-1)?.userID, saved.rotationQueue[1]);
  assert.equal(final.definitions[0]?.currentRotationIndex, 2);
});

test("esporádica usa o saldo de justiça sem recorrência", async () => {
  const { env, marina, definition, schedule } = fixture();
  await env.tasks.create({ ...definition, kind: "sporadic", recurrence: NO_RECURRENCE, assignmentPolicy: "selfAssigned" }, marina.id, DATE);
  const occurrence = schedule().occurrences[0];
  assert.ok(occurrence !== undefined);
  await env.tasks.claim(occurrence.id, marina.id, DATE);
  await env.tasks.claim(occurrence.id, marina.id, DATE);
  await env.tasks.complete(occurrence.id, marina.id, DATE);
  const state = schedule();
  assert.equal(state.occurrences.length, 1);
  assert.equal(state.assignments.length, 1);
  assert.equal(state.definitions[0]?.rotationQueue.length, 0);
  assert.equal(state.roomMemberships.find((m) => m.roomID === definition.roomID && m.userID === marina.id)?.fairnessDebt, 2.25);
});

test("criações concorrentes enxergam a carga já gravada da casa", async () => {
  const { world, env, marina, kitchen, definition, schedule } = fixture();
  const second = world.definition(kitchen.id, { name: "Segunda", effort: definition.effort.points });
  const [firstSaved, secondSaved] = await Promise.all([
    env.tasks.create(definition, marina.id, DATE), env.tasks.create(second, marina.id, DATE),
  ]);
  assert.notEqual(firstSaved.rotationQueue[0], secondSaved.rotationQueue[0]);
  assert.equal(schedule().occurrences.length, 24);
});

test("entrada de morador replaneja a próxima semana e preserva a atual", async () => {
  const { world, env, marina, definition, schedule, calendar } = fixture();
  const rafa = world.seed.users.rafa;
  env.store.update((s) => {
    s.roomMemberships = s.roomMemberships.filter((m) => !(m.roomID === definition.roomID && m.userID === rafa.id));
  });
  await env.tasks.create(definition, marina.id, DATE);
  const before = schedule();
  await new AddRoomMemberUseCase(env.tasks, () => world.now).execute(rafa.id, definition.roomID, DATE);
  const after = schedule();
  await env.tasks.addMember(rafa.id, definition.roomID, DATE);
  assert.deepEqual(schedule().assignments, after.assignments);
  const boundary = calendar.addWeeks(calendar.weekStart(DATE), 1);
  assert.equal(after.definitions[0]?.rotationQueue.length, 4);
  assert.deepEqual(after.occurrences.filter((o) => o.availableAt < boundary), before.occurrences.filter((o) => o.availableAt < boundary));
  const firstOccurrence = before.occurrences[0];
  assert.ok(firstOccurrence !== undefined);
  assert.deepEqual(after.assignments.find((a) => a.occurrenceID === firstOccurrence.id && isActiveAssignment(a)), before.assignments[0]);
  assert.deepEqual(after.occurrences.slice(0, before.occurrences.length).map((o) => o.id), before.occurrences.map((o) => o.id));
  const nextScheduled = before.definitions[0]?.nextScheduledAt;
  assert.ok(nextScheduled !== null && nextScheduled !== undefined);
  assert.ok(after.assignments.some((a) => a.userID === rafa.id && isActiveAssignment(a) && a.assignedAt < nextScheduled));
  assert.ok(after.assignments.some((a) => a.supersededAt === DATE));
  assert.ok(after.assignments.every((a) => a.endedAt === null || a.endedAt >= a.assignedAt));
  assert.equal(after.roomMemberships.filter((m) => m.roomID === definition.roomID && m.userID === rafa.id).length, 1);
});

test("recorrência inválida e cômodo sem participantes não criam nada pela metade", async () => {
  const { world, env, marina, definition, schedule } = fixture();
  const useCase = new CreateTaskUseCase(env.tasks, () => world.now);
  await assert.rejects(
    useCase.execute({ ...definition, recurrence: recurring("weekly", 0) }, marina.id, DATE), code("invalidSchedule"),
  );
  const empty = () => schedule().definitions.length === 0 && schedule().occurrences.length === 0 && schedule().assignments.length === 0;
  assert.ok(empty());
  env.store.update((s) => {
    s.roomMemberships = s.roomMemberships.filter((m) => m.roomID !== definition.roomID);
  });
  await assert.rejects(env.tasks.create(definition, marina.id, DATE), code("taskUnavailable"));
  assert.ok(empty());
});

test("criar tarefa exige participação no cômodo", async () => {
  const { env, marina, definition } = fixture();
  env.store.update((s) => {
    s.roomMemberships = s.roomMemberships.filter((m) => !(m.roomID === definition.roomID && m.userID === marina.id));
  });
  await assert.rejects(env.tasks.create(definition, marina.id, DATE), code("taskUnavailable"));
});

test("o calendário sobrevive à fronteira do horário de verão", async () => {
  const zone = "America/New_York";
  const { env, marina, definition, schedule, calendar } = fixture(zone);
  const first = Date.UTC(2026, 9, 26, 4); // 26/out 00:00 em Nova York (EDT)
  assert.equal(calendar.startOfDay(first), first);
  await env.tasks.create(definition, marina.id, first);
  const occurrences = schedule().occurrences;
  assert.equal((occurrences[1]?.availableAt ?? 0) - first, 169 * 3_600_000);
  assert.ok(occurrences.every((o) => calendar.startOfDay(o.availableAt) === o.availableAt));
  assert.ok(occurrences.every((o) => calendar.isoWeekday(o.availableAt) === 1));
});

test("ausência fica fora do saldo de justiça da conclusão", async () => {
  const { world, env, marina, definition, schedule } = fixture();
  await env.tasks.create(definition, marina.id, DATE);
  const first = schedule().assignments[0];
  assert.ok(first !== undefined);
  const absent = schedule().houseMemberships.find((m) => m.userID !== first.userID);
  assert.ok(absent !== undefined);
  const absence = createAbsence({ id: absenceID(world.newID()), membershipID: absent.id, startsAt: DATE - 1000, endsAt: DATE + 3_600_000 });
  env.store.update((s) => {
    s.absences.push(absence);
  });
  await env.tasks.complete(first.occurrenceID, first.userID, DATE);
  const memberships = schedule().roomMemberships.filter((m) => m.roomID === definition.roomID);
  assert.equal(memberships.find((m) => m.userID === first.userID)?.fairnessDebt, 2);
  assert.equal(memberships.find((m) => m.userID === absent.userID)?.fairnessDebt, 0);
  assert.equal(memberships.reduce((sum, m) => sum + m.fairnessDebt, 0), 0);
});

test("vínculo duplicado desfaz a conclusão", async () => {
  const { world, env, marina, definition, schedule } = fixture();
  await env.tasks.create(definition, marina.id, DATE);
  const first = schedule().assignments[0];
  assert.ok(first !== undefined);
  const duplicate: RoomMembership = {
    id: roomMembershipID(world.newID()), roomID: definition.roomID, userID: first.userID, fairnessDebt: 0,
    leftAt: null, rotationChanges: null,
  };
  env.store.update((s) => {
    s.roomMemberships.push(duplicate);
  });
  const before = schedule();
  await assert.rejects(env.tasks.complete(first.occurrenceID, first.userID, DATE), code("invalidDistribution"));
  const after = schedule();
  assert.deepEqual(after.occurrences, before.occurrences);
  assert.deepEqual(after.assignments, before.assignments);
  assert.deepEqual(after.roomMemberships, before.roomMemberships);
});

test("o caso de uso aceita só combinações válidas de política e recorrência (escolhas do editor)", async () => {
  const { world, env, marina, kitchen, definition, schedule } = fixture();
  const useCase = new CreateTaskUseCase(env.tasks, () => world.now);
  const avulsa = { ...definition, name: "Avulsa", kind: "sporadic" as const, recurrence: NO_RECURRENCE, assignmentPolicy: "selfAssigned" as const };
  const saved = await useCase.execute(avulsa, marina.id, DATE);
  assert.equal(saved.kind, "sporadic");
  assert.equal(schedule().occurrences.length, 1);
  const invalid = [
    { ...definition, id: world.definition(kitchen.id).id, recurrence: NO_RECURRENCE },                       // calendário sem recorrência
    { ...avulsa, id: world.definition(kitchen.id).id, recurrence: recurring("weekly", 1) },                  // esporádica recorrente
    { ...definition, id: world.definition(kitchen.id).id, assignmentPolicy: "selfAssigned" as const },       // recorrente autoatribuída
  ];
  for (const candidate of invalid) await assert.rejects(useCase.execute(candidate, marina.id, DATE), code("invalidSchedule"));
  const afterCompletion = { ...definition, id: world.definition(kitchen.id).id, recurrence: NO_RECURRENCE, assignmentPolicy: "afterCompletion" as const };
  assert.equal((await useCase.execute(afterCompletion, marina.id, DATE)).assignmentPolicy, "afterCompletion");
});

test("prazos ordenam de forma crescente, com tarefas sem prazo por último", async () => {
  const world = new World();
  const kitchenID = world.seed.rooms.kitchen.id;
  const definition = world.seed.state.definitions.find((d) => d.roomID === kitchenID);
  assert.ok(definition !== undefined);
  const dates = [null, 300_000, 100_000];
  const state = world.cleanState();
  state.definitions = [definition];
  state.occurrences = dates.map((dueAt) => ({
    id: taskOccurrenceID(world.newID()), taskDefinitionID: definition.id,
    availableAt: DISTANT_PAST, dueAt, status: "available" as const, completedAt: null, completedByUserID: null,
    completionDebtImpacts: null, didPublishSuccessor: null, effortSnapshot: definition.effort,
  }));
  const env = world.env(state);
  const tasks = await new GetRoomTasksUseCase(env.tasks).execute(kitchenID, world.seed.currentUser.id);
  assert.deepEqual(tasks.map((t) => t.occurrence.dueAt), [dates[2], dates[1], null]);
});

test("concluir mantém o morador e atualiza o estado do cômodo", async () => {
  const world = new World();
  const env = world.env();
  const kitchenID = world.seed.rooms.kitchen.id;
  const state = env.store.read((s) => s);
  const kitchenDefinitions = new Set(state.definitions.filter((d) => d.roomID === kitchenID).map((d) => d.id));
  const occurrence = state.occurrences.find((o) => kitchenDefinitions.has(o.taskDefinitionID) && o.availableAt <= world.now);
  assert.ok(occurrence !== undefined);
  const owner = activeOwner(state, occurrence);
  assert.ok(owner !== undefined);
  const resident = state.users.find((u) => u.id === owner);
  assert.ok(resident !== undefined);
  const getRoomTasks = new GetRoomTasksUseCase(env.tasks);
  const item = (await getRoomTasks.execute(kitchenID, resident.id)).find((t) => t.assignment?.userID === resident.id && t.occurrence.availableAt <= world.now);
  assert.ok(item !== undefined);
  assert.deepEqual(item.assignee, resident);
  await new CompleteTaskUseCase(env.tasks, () => world.now).execute(item.occurrence.id, resident.id);
  const completed = (await getRoomTasks.execute(kitchenID, resident.id)).find((t) => t.occurrence.id === item.occurrence.id);
  assert.ok(completed !== undefined && isCompleted(completed.occurrence));
  assert.deepEqual(completed.assignee, resident);
});

test("o perfil lista todos os moradores e rejeita quem é de fora", async () => {
  const world = new World();
  const env = world.env();
  const useCase = new GetHouseMembersUseCase(env.houses);
  const members = await useCase.execute(world.seed.house.id, world.seed.currentUser.id);
  assert.deepEqual(new Set(members.map((u) => u.id)), new Set(Object.values(world.seed.users).map((u) => u.id)));
  await assert.rejects(useCase.execute(world.seed.house.id, userID(uuid(999))), code("taskUnavailable"));
});
