import { at } from "../src/domain/arrays.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar, localToInstant, type Instant } from "../src/domain/dates.ts";
import { cloneSchedulingState, isCompleted, type Room, type RoomMembership, type SchedulingState, type TaskDefinition } from "../src/domain/entities.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { cloneStoreState } from "../src/domain/store-state.ts";
import { roomID as toRoomID, roomMembershipID, userID, type UserID } from "../src/domain/ids.ts";
import { HouseQueueOptimizer, type QueueForecast } from "../src/domain/services/house-queue-optimizer.ts";
import { addEffort, emptyWeeks, type ProjectedWeek } from "../src/domain/services/task-distribution-engine.ts";
import { isValidPeriodicity, weeklyPeriodicity, weeklyRecurrence } from "../src/domain/value-objects.ts";
import { activeOwner, permutations, uuid, World } from "./support/world.ts";

const ZONE = "America/Sao_Paulo";
const calendar = createCalendar(ZONE);
const monday = localToInstant(ZONE, { year: 2026, month: 9, day: 14 });
const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);

function first<T>(items: readonly T[]): T {
  const value = items[0];
  assert.ok(value !== undefined);
  return value;
}

function setup(options: { count?: number; n?: number; weeks?: number } = {}) {
  const world = new World({ timezone: ZONE });
  world.now = monday;
  const { n = 2, weeks = 2, count = 1 } = options;
  const state = world.cleanState(weeklyPeriodicity(n, weeks), { responsibleCount: count, anchor: monday });
  const task = (opts: { effort?: number; n?: number; weeks?: number; room?: Room["id"] } = {}): TaskDefinition =>
    world.definition(opts.room ?? world.seed.rooms.kitchen.id, {
      effort: opts.effort ?? 2, recurrence: weeklyRecurrence(weeklyPeriodicity(opts.n ?? 2, opts.weeks ?? 2)),
    });
  return { world, service: world.service(), state, task, users: world.seed.users, rooms: world.seed.rooms, house: world.seed.house };
}

const sameSet = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a.size === b.size && [...a].every((x) => b.has(x));

function ownersOn(state: SchedulingState, date: Instant): Set<UserID> {
  const result = new Set<UserID>();
  for (const o of state.occurrences) {
    if (o.availableAt !== date) continue;
    const owner = activeOwner(state, o);
    if (owner !== undefined) result.add(owner);
  }
  return result;
}

test("tarefas vinculadas compartilham responsáveis e só rodam depois do período", () => {
  const { service, state, task, house } = setup();
  const a = service.create(task(), monday, state);
  const b = service.create(task({ effort: 3 }), monday, state);
  assert.ok(a.rotationQueue.length === 0 && b.rotationQueue.length === 0);
  const dates = [...new Set(state.occurrences.map((o) => o.availableAt))].sort((x, y) => x - y);
  const owners = dates.map((d) => ownersOn(state, d));
  assert.ok(owners.every((o) => o.size === 1));
  assert.ok(sameSet(owners[0] ?? new Set(), owners[1] ?? new Set()));
  assert.ok(!sameSet(owners[1] ?? new Set(), owners[2] ?? new Set()));
  assert.equal(new Set(owners.slice(0, 8).flatMap((o) => [...o])).size, 4);
  const before = [...state.occurrences];
  service.refresh(house.id, monday, state);
  assert.deepEqual(state.occurrences, before);
});

test("blocos gulosos ficam equilibrados e dentro do grupo responsável", () => {
  const { service, state, task, rooms } = setup({ count: 2 });
  for (const effort of [3, 3, 2, 2, 1]) service.create(task({ effort }), monday, state);
  const room = state.rooms.find((r) => r.id === rooms.kitchen.id);
  const version = room?.scheduleVersions.at(-1);
  assert.ok(version !== undefined);
  const load = [0, 0];
  for (const d of state.definitions) {
    const role = version.taskRoles[d.id];
    assert.ok(role !== undefined);
    load[role] = (load[role] ?? 0) + d.effort.points;
  }
  assert.deepEqual([...load].sort(), [5, 6]);
  for (const o of state.occurrences) {
    const d = state.definitions.find((x) => x.id === o.taskDefinitionID);
    assert.ok(d !== undefined);
    assert.equal(activeOwner(state, o), service.roomOwner(d, o.availableAt, state) ?? undefined);
  }
  assert.equal(ownersOn(state, monday).size, 2);
});

test("criação no meio do período não publica datas passadas e usa contagens exatas", () => {
  const { service, state, task } = setup({ n: 3, weeks: 2 });
  const start = calendar.addDays(monday, 3);
  const d = service.create(task({ n: 3, weeks: 2 }), start, state);
  const dates = state.occurrences.map((o) => o.availableAt).sort((a, b) => a - b);
  assert.deepEqual(dates.slice(0, 3).map((t) => calendar.daysBetween(monday, t)), [4, 9, 14]);
  assert.ok(dates.every((t) => t >= start));
  assert.equal(d.rotationQueue.length, 0);
  const other = service.create(task({ n: 6, weeks: 4 }), start, state);
  assert.ok(other.rotationQueue.length > 0); // A mesma razão não é o mesmo período.
});

test("saídas preservam o passado e replanejam o cômodo como uma unidade", () => {
  const { service, state, task, rooms } = setup({ count: 2 });
  for (const effort of [3, 2, 1]) service.create(task({ effort }), monday, state);
  const before = cloneSchedulingState(state);
  const user = activeOwner(state, first(state.occurrences));
  assert.ok(user !== undefined);
  const wednesday = calendar.addDays(monday, 2);
  const boundary = calendar.addDays(monday, 7);
  service.removeMember(user, rooms.kitchen.id, wednesday, state);
  assert.equal(state.rooms.find((r) => r.id === rooms.kitchen.id)?.visibility, "privateRoom");
  for (const o of state.occurrences) {
    if (o.availableAt < boundary) {
      assert.equal(activeOwner(state, o), activeOwner(before, o));
    } else {
      assert.notEqual(activeOwner(state, o), user);
      const d = state.definitions.find((x) => x.id === o.taskDefinitionID);
      assert.ok(d !== undefined);
      assert.equal(activeOwner(state, o), service.roomOwner(d, o.availableAt, state) ?? undefined);
    }
  }
  service.addMember(user, rooms.kitchen.id, wednesday, state);
  assert.equal(state.rooms.find((r) => r.id === rooms.kitchen.id)?.visibility, "privateRoom");
});

test("cômodo privado é descobrível, mas não vaza nem aceita tarefas de fora", async () => {
  const { world, state, task, users, rooms, house } = setup();
  const env = world.env(state);
  const d = task({ room: rooms.privateOffice.id });
  await env.tasks.create(d, users.marina.id, monday);
  assert.ok((await env.rooms.rooms(house.id, users.rafa.id)).some((r) => r.id === d.roomID));
  assert.equal((await env.rooms.room(d.roomID, users.rafa.id)).scheduleVersions.length, 0);
  assert.equal((await env.tasks.roomTasks(d.roomID, users.rafa.id)).length, 0);
  await assert.rejects(env.tasks.create(d, users.rafa.id, monday), code("taskUnavailable"));
  await env.tasks.addMember(users.rafa.id, d.roomID, monday);
  assert.ok((await env.tasks.roomTasks(d.roomID, users.rafa.id)).length > 0);
  await env.tasks.create(task({ room: d.roomID }), users.rafa.id, monday);
  await assert.rejects(env.rooms.room(d.roomID, userID(uuid(999))), code("entityNotFound"));
});

test("criação comum rejeita participação incompleta e a casa toda não pode ser deixada", async () => {
  const world = new World({ timezone: ZONE });
  world.now = monday;
  const env = world.env();
  const room: Room = {
    id: toRoomID(world.newID()), houseID: world.seed.house.id, name: "Novo", kind: "standard", category: "other",
    visibility: "common", periodicity: weeklyPeriodicity(), responsibleCount: 1, calendarAnchor: null, scheduleVersions: [],
    icon: "house.fill", color: "blue",
  };
  const membership: RoomMembership = {
    id: roomMembershipID(world.newID()), roomID: room.id, userID: world.seed.currentUser.id, fairnessDebt: 0, leftAt: null,
    rotationChanges: null,
  };
  await assert.rejects(env.rooms.create(room, [membership]), code("invalidRoomParticipants"));
  await assert.rejects(
    env.tasks.removeMember(world.seed.currentUser.id, world.seed.rooms.wholeHouse.id, monday, true), code("wholeHouseProtected"),
  );
});

test("a exclusão é atômica e a tentativa sem confirmação preserva tudo", async () => {
  const { world, state, task, users, rooms } = setup();
  state.roomMemberships = state.roomMemberships.filter((m) => !(m.roomID === rooms.privateOffice.id && m.userID !== users.marina.id));
  const env = world.env(state);
  await env.tasks.create(task({ room: rooms.privateOffice.id }), users.marina.id, monday);
  const before = env.store.read((s) => s);
  await assert.rejects(env.tasks.removeMember(users.marina.id, rooms.privateOffice.id, monday, false), code("deletionConfirmationRequired"));
  assert.deepEqual(env.store.read((s) => s.occurrences), before.occurrences);
  assert.deepEqual(env.store.read((s) => s.rooms), before.rooms);
  await env.tasks.removeMember(users.marina.id, rooms.privateOffice.id, monday, true);
  const after = env.store.read((s) => s);
  assert.ok(after.definitions.length === 0 && after.occurrences.length === 0 && after.assignments.length === 0);
  assert.ok(!after.roomMemberships.some((m) => m.roomID === rooms.privateOffice.id));
});

test("periodicidade inválida e vários responsáveis respeitam as restrições", () => {
  assert.ok(!isValidPeriodicity(weeklyPeriodicity(8, 1)));
  assert.ok(!isValidPeriodicity(weeklyPeriodicity(0, 1)));
  assert.ok(!isValidPeriodicity(weeklyPeriodicity(1, 0)));
  const { service, state, task, rooms } = setup({ count: 10 });
  service.create(task(), monday, state);
  assert.equal(state.rooms.find((r) => r.id === rooms.kitchen.id)?.scheduleVersions.at(-1)?.responsibleCount, 4);
});

test("tarefa nova no período mantém o responsável atual e a saída pendente", () => {
  const { service, state, task, users } = setup({ n: 2, weeks: 2 });
  const original = service.create(task(), monday, state);
  const firstOwner = activeOwner(state, first(state.occurrences));
  assert.ok(firstOwner !== undefined);
  const wednesday = calendar.addDays(monday, 2);
  const other = Object.values(users).find((u) => u.id !== firstOwner);
  assert.ok(other !== undefined);
  service.removeMember(other.id, original.roomID, wednesday, state);
  const added = service.create(task({ effort: 3 }), wednesday, state);
  const room = state.rooms.find((r) => r.id === original.roomID);
  const version = room?.scheduleVersions.filter((v) => v.effectiveAt <= wednesday).at(-1);
  assert.equal(version?.queue[0], firstOwner);
  const boundary = calendar.addDays(monday, 7);
  assert.ok(state.occurrences.filter((o) => o.availableAt >= boundary).every((o) => activeOwner(state, o) !== other.id));
  assert.ok(state.occurrences.filter((o) => o.taskDefinitionID === added.id).every((o) => o.availableAt >= wednesday));
});

test("grupos semanais atravessam o horário de verão sem deriva", () => {
  const zone = "America/New_York";
  const cal = createCalendar(zone);
  const start = localToInstant(zone, { year: 2026, month: 10, day: 26 });
  const world = new World({ timezone: zone });
  const state = world.cleanState(weeklyPeriodicity(2, 2), { anchor: start });
  world.service(zone).create(
    world.definition(world.seed.rooms.kitchen.id, { effort: 2, recurrence: weeklyRecurrence(weeklyPeriodicity(2, 2)) }), start, state,
  );
  const dates = state.occurrences.map((o) => o.availableAt).sort((a, b) => a - b);
  assert.equal((dates[1] ?? 0) - (dates[0] ?? 0), 169 * 3_600_000);
  assert.ok(dates.every((t) => cal.startOfDay(t) === t));
});

test("a otimização por posições bate com a busca exaustiva", () => {
  const users = [1, 2, 3].map((n) => userID(uuid(n)));
  const turns = Array.from({ length: 12 }, (_, week) =>
    [1, 3].map((effort) => ({ week, effort, eligible: new Set(users), incumbent: null, slot: Math.floor(week / 2) }))).flat();
  const forecast: QueueForecast = { participants: users, turns, isFixed: false, existingQueue: users };
  const weeks = emptyWeeks();
  for (let i = 0; i < 12; i++) if (i % 3 === 0) weeks[i] = addEffort(at(weeks, i), 3);
  const fixed = new Map([[at(users, 0), weeks]]);
  const optimizer = new HouseQueueOptimizer();
  const result = optimizer.optimize([forecast], fixed, new Map());
  const costs = permutations(users.map((_, i) => i)).map((p) =>
    optimizer.score([forecast], [p.map((i) => at(users, i))], fixed, new Map()));
  const best = costs.reduce((a, b) => (b.effort < a.effort || (b.effort === a.effort && (b.difficulty < a.difficulty ||
    (b.difficulty === a.difficulty && (b.debt < a.debt || (b.debt === a.debt && b.changes < a.changes))))) ? b : a));
  assert.deepEqual(optimizer.score([forecast], result, fixed, new Map()), best);
});

test("saída da casa confirma a cascata de privados e mantém os cômodos comuns comuns", async () => {
  const world = new World({ timezone: ZONE });
  world.now = monday;
  const { users, rooms, house } = world.seed;
  const full = cloneStoreState(world.seed.state);
  full.roomMemberships = full.roomMemberships.filter((m) => m.roomID !== rooms.privateOffice.id);
  full.roomMemberships.push({
    id: roomMembershipID(world.newID()), roomID: rooms.privateOffice.id, userID: users.rafa.id, fairnessDebt: 0, leftAt: null,
    rotationChanges: null,
  });
  const env = world.env(full);
  const before = env.store.read((s) => s);
  await assert.rejects(
    env.houses.removeMember(users.rafa.id, house.id, users.marina.id, monday, false), code("deletionConfirmationRequired"),
  );
  assert.deepEqual(env.store.read((s) => s.houseMemberships), before.houseMemberships);
  assert.deepEqual(env.store.read((s) => s.rooms), before.rooms);
  await env.houses.removeMember(users.rafa.id, house.id, users.marina.id, monday, true);
  const after = env.store.read((s) => s);
  assert.ok(!after.rooms.some((r) => r.id === rooms.privateOffice.id));
  assert.ok(after.rooms.every((r) => r.visibility === "common"));
  const everyone = new Set(after.houseMemberships.map((m) => m.userID));
  for (const room of after.rooms) {
    const current = new Set(after.roomMemberships.filter((m) => m.roomID === room.id && m.leftAt === null).map((m) => m.userID));
    assert.ok(sameSet(current, everyone));
  }
});

test("a escala vinculada se estende além do horizonte sem duplicar", () => {
  const { service, state, task, house } = setup({ n: 3, weeks: 2 });
  service.create(task({ n: 3, weeks: 2 }), monday, state);
  const original = [...state.occurrences];
  const future = calendar.addWeeks(monday, 30);
  service.refresh(house.id, future, state);
  const extended = [...state.occurrences];
  service.refresh(house.id, future, state);
  assert.deepEqual(state.occurrences, extended);
  assert.deepEqual(extended.slice(0, original.length), original);
  assert.equal(new Set(extended.map((o) => o.availableAt)).size, extended.length);
  const definition = first(state.definitions);
  for (const occurrence of extended) {
    assert.equal(activeOwner(state, occurrence), service.roomOwner(definition, occurrence.availableAt, state) ?? undefined);
  }
  assert.ok(extended.every((o) => !isCompleted(o)));
});
