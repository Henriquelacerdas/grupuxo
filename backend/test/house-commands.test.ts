import assert from "node:assert/strict";
import { test } from "node:test";
import { createHouse, joinHouseByCode, leaveHouse, normalizeAccessCode, removeHouseMember } from "../src/domain/commands/houses.ts";
import { isCurrentMember } from "../src/domain/entities.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { userID as toUserID } from "../src/domain/ids.ts";
import { emptyStoreState, type StoreState } from "../src/domain/store-state.ts";
import { InMemoryStore } from "../src/adapters/in-memory/store.ts";
import { World } from "./support/world.ts";

const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);
const SAO_PAULO = "America/Sao_Paulo";

function newHouseEnv() {
  const world = new World({ timezone: SAO_PAULO });
  const founder = toUserID(world.newID());
  const state = emptyStoreState();
  state.users.push({ id: founder, name: "Fundadora", email: null });
  const store = new InMemoryStore(state);
  const create = (name = "Casa nova", timezone = SAO_PAULO, accessCode = () => "abcd1234") =>
    store.update((s) => createHouse(world.ctx, s, founder, name, timezone, accessCode, world.now));
  return { world, founder, store, create };
}

test("createHouse: fundador, 'Casa toda' e escala inicial", () => {
  const { world, founder, store, create } = newHouseEnv();
  const house = create("  Casa da Rua A \n");
  assert.equal(house.name, "Casa da Rua A");
  assert.equal(house.accessCode, "ABCD1234");
  assert.equal(house.timezone, SAO_PAULO);
  assert.equal(house.createdAt, world.now);
  const state = store.read((s) => s);
  assert.deepEqual(state.houses, [house]);
  assert.deepEqual(state.houseMemberships.map((m) => [m.houseID, m.userID]), [[house.id, founder]]);
  const [room] = state.rooms;
  assert.equal(state.rooms.length, 1);
  assert.equal(room?.name, "Casa toda");
  assert.equal(room?.kind, "wholeHouse");
  assert.equal(room?.visibility, "common");
  assert.notEqual(room?.calendarAnchor, null);
  assert.equal(room?.scheduleVersions.length, 1);
  assert.deepEqual(room?.scheduleVersions[0]?.queue, [founder]);
  const memberships = state.roomMemberships.filter((m) => m.roomID === room?.id);
  assert.deepEqual(memberships.map((m) => m.userID), [founder]);
  assert.ok(memberships.every(isCurrentMember));
});

test("createHouse: valida nome, fuso e código", () => {
  const { store, create } = newHouseEnv();
  for (const name of ["", "   \n", "a".repeat(81), "Casa\u0007"]) assert.throws(() => create(name), code("invalidHouseName"));
  assert.doesNotThrow(() => create("é".repeat(80)));
  assert.throws(() => create("Casa", "Marte/Olympus"), code("invalidTimezone"));
  assert.throws(() => create("Casa", ""), code("invalidTimezone"));
  for (const bad of ["", "abc", "tem espaco", "ç".repeat(6), "A".repeat(17)]) {
    assert.throws(() => create("Casa", SAO_PAULO, () => bad), code("invalidAccessCode"));
  }
  // Só a criação válida acima gravou algo: as recusadas fizeram rollback.
  assert.equal(store.read((s) => s.houses.length), 1);
});

test("normalizeAccessCode: aparado, em maiúsculas e só ASCII alfanumérico de 4 a 16", () => {
  assert.equal(normalizeAccessCode("  grupuxo\n"), "GRUPUXO");
  assert.equal(normalizeAccessCode("ab12"), "AB12");
  for (const bad of ["abc", "abc-1234", "a b c d", "", "x".repeat(17), "çççççç"]) assert.equal(normalizeAccessCode(bad), null);
});

test("joinHouseByCode: entra nos cômodos comuns, replaneja e é idempotente", () => {
  const world = new World({ timezone: SAO_PAULO });
  const { house, rooms } = world.seed;
  const env = world.env();
  const newcomer = toUserID(world.newID());
  env.store.update((s) => { s.users.push({ id: newcomer, name: "Nova", email: null }); });

  const joined = env.store.update((s) => joinHouseByCode(world.ctx, s, newcomer, "  grupuxo ", world.now));
  assert.equal(joined.id, house.id);
  const state = env.store.read((s) => s);
  assert.ok(state.houseMemberships.some((m) => m.houseID === house.id && m.userID === newcomer));
  const common = state.rooms.filter((r) => r.houseID === house.id && r.visibility === "common");
  assert.ok(common.every((r) => state.roomMemberships.some((m) => m.roomID === r.id && m.userID === newcomer && isCurrentMember(m))));
  assert.ok(!state.roomMemberships.some((m) => m.roomID === rooms.privateOffice.id && m.userID === newcomer));

  const again = env.store.update((s) => joinHouseByCode(world.ctx, s, newcomer, "GRUPUXO", world.now));
  assert.equal(again.id, house.id);
  assert.deepEqual(env.store.read((s) => s), state);
});

test("joinHouseByCode: código inexistente ou malformado e perfil ausente falham sem gravar", () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = world.env();
  const before = env.store.read((s) => s);
  const newcomer = toUserID(world.newID());
  env.store.update((s) => { s.users.push({ id: newcomer, name: "Nova", email: null }); });
  for (const bad of ["ZZZZZZZZ", "x", "", "GRUPUXO!"]) {
    assert.throws(() => env.store.update((s) => joinHouseByCode(world.ctx, s, newcomer, bad, world.now)), code("invalidAccessCode"));
  }
  const stranger = toUserID(world.newID());
  assert.throws(() => env.store.update((s) => joinHouseByCode(world.ctx, s, stranger, "GRUPUXO", world.now)), code("entityNotFound"));
  const after: StoreState = env.store.read((s) => s);
  assert.deepEqual({ ...after, users: [] }, { ...before, users: [] });
});

test("leaveHouse: sai de todos os cômodos e deixa o mesmo estado que removeHouseMember", () => {
  const world = new World({ timezone: SAO_PAULO });
  const { house, users } = world.seed;
  const env = world.env();
  env.store.update((s) => leaveHouse(world.ctx, s, users.rafa.id, house.id, world.now, false));
  const state = env.store.read((s) => s);
  assert.ok(!state.houseMemberships.some((m) => m.userID === users.rafa.id));
  assert.ok(!state.roomMemberships.some((m) => m.userID === users.rafa.id && isCurrentMember(m)));
  assert.equal(state.houseMemberships.length, 3);

  // Mesmo mundo determinístico: sair equivale a Marina remover a Rafa (só muda quem pede).
  const reference = new World({ timezone: SAO_PAULO });
  const referenceEnv = reference.env();
  referenceEnv.store.update((s) => removeHouseMember(
    reference.ctx, s, reference.seed.users.rafa.id, reference.seed.house.id, reference.seed.users.marina.id, reference.now, false,
  ));
  assert.deepEqual(state, referenceEnv.store.read((s) => s));
});

test("leaveHouse: último morador só sai confirmando a exclusão da casa; quem não é da casa é 'não encontrado'", () => {
  const { world, founder, store, create } = newHouseEnv();
  const house = create();
  assert.throws(() => store.update((s) => leaveHouse(world.ctx, s, founder, house.id, world.now, true)), code("houseDeletionConfirmationRequired"));
  const stranger = toUserID(world.newID());
  assert.throws(() => store.update((s) => leaveHouse(world.ctx, s, stranger, house.id, world.now, false)), code("entityNotFound"));
  assert.throws(() => store.update((s) => leaveHouse(world.ctx, s, founder, house.id.replace(/.$/, "0") as typeof house.id, world.now, false)), code("entityNotFound"));
  assert.equal(store.read((s) => s.houseMemberships.length), 1);
});

test("leaveHouse: o último morador confirmando exclui a casa inteira e mantém os perfis", () => {
  const world = new World({ timezone: SAO_PAULO });
  const { house, users } = world.seed;
  const env = world.env();
  const other = env.store.update((s) => createHouse(world.ctx, s, users.leo.id, "Outra casa", SAO_PAULO, () => "OUTRA123", world.now));
  for (const user of [users.rafa, users.bia, users.leo]) {
    env.store.update((s) => leaveHouse(world.ctx, s, user.id, house.id, world.now, true));
  }
  const before = env.store.read((s) => s);
  assert.equal(env.store.update((s) => leaveHouse(world.ctx, s, users.marina.id, house.id, world.now, false, true)), "houseDeleted");
  const state = env.store.read((s) => s);
  const otherRooms = new Set(state.rooms.map((r) => r.id));
  assert.deepEqual(state.houses, [other]);
  assert.deepEqual(state.houseMemberships.map((m) => m.houseID), [other.id]);
  assert.ok(state.rooms.every((r) => r.houseID === other.id));
  assert.ok(state.roomMemberships.every((m) => otherRooms.has(m.roomID)));
  assert.ok(state.definitions.every((d) => otherRooms.has(d.roomID)));
  const definitions = new Set(state.definitions.map((d) => d.id));
  assert.ok(state.occurrences.every((o) => definitions.has(o.taskDefinitionID)));
  const occurrences = new Set(state.occurrences.map((o) => o.id));
  assert.ok(state.assignments.every((a) => occurrences.has(a.occurrenceID)));
  assert.ok(before.occurrences.length > state.occurrences.length);
  assert.deepEqual(state.absences, []);
  assert.deepEqual(state.taskSwapRequests, []);
  assert.deepEqual(state.notifications, []);
  assert.deepEqual(state.users, before.users);
});

test("leaveHouse: último participante de um cômodo exige confirmação e o cômodo é excluído com ela", () => {
  const world = new World({ timezone: SAO_PAULO });
  const { house, users, rooms } = world.seed;
  const env = world.env();
  // O escritório privado tem Marina e Bia: Bia sai, Marina fica como a única participante.
  env.store.update((s) => { s.roomMemberships = s.roomMemberships.filter((m) => !(m.roomID === rooms.privateOffice.id && m.userID === users.bia.id)); });
  const before = env.store.read((s) => s);
  assert.throws(() => env.store.update((s) => leaveHouse(world.ctx, s, users.marina.id, house.id, world.now, false)), code("deletionConfirmationRequired"));
  assert.deepEqual(env.store.read((s) => s), before);

  env.store.update((s) => leaveHouse(world.ctx, s, users.marina.id, house.id, world.now, true));
  const state = env.store.read((s) => s);
  assert.ok(!state.rooms.some((r) => r.id === rooms.privateOffice.id));
  assert.ok(!state.houseMemberships.some((m) => m.userID === users.marina.id));
});
