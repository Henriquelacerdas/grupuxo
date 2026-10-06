import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentMember, isCompleted } from "../src/domain/entities.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { cloneStoreState } from "../src/domain/store-state.ts";
import {
  AddHouseMemberUseCase, CreateRoomUseCase, GetHouseMembersUseCase, RemoveHouseMemberUseCase,
} from "../src/domain/use-cases/houses-and-rooms.ts";
import { World } from "./support/world.ts";

const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);

function setup() {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  return { world, env, ...world.seed, now: () => world.now };
}

test("adiciona morador só com o nome aparado", async () => {
  const { world, env, house, users, rooms } = setup();
  const user = await new AddHouseMemberUseCase(env.houses, () => world.now).execute("  Nova Moradora \n", house.id, users.marina.id);
  assert.equal(user.name, "Nova Moradora");
  assert.equal(user.email, null);
  assert.ok((await env.houses.memberIDs(house.id)).includes(user.id));
  const state = env.store.read((s) => s);
  const common = state.rooms.filter((r) => r.houseID === house.id && r.visibility === "common").map((r) => r.id);
  assert.ok(!state.roomMemberships.some((m) => m.roomID === rooms.privateOffice.id && m.userID === user.id));
  assert.ok(common.every((roomID) => state.roomMemberships.some((m) => m.roomID === roomID && m.userID === user.id && isCurrentMember(m))));
});

test("rejeita nome em branco sem alterar os moradores", async () => {
  const { world, env, house, users } = setup();
  const before = await env.houses.members(house.id);
  await assert.rejects(
    new AddHouseMemberUseCase(env.houses, () => world.now).execute(" \n ", house.id, users.marina.id), code("invalidResidentName"),
  );
  assert.deepEqual(await env.houses.members(house.id), before);
});

test("a remoção encerra a participação nos cômodos e preserva o histórico do usuário", async () => {
  const { world, env, house, users } = setup();
  const before = env.store.read((s) => s);
  const user = before.houseMemberships.find((m) => m.houseID === house.id && m.userID !== users.marina.id)?.userID;
  assert.ok(user !== undefined);
  await new RemoveHouseMemberUseCase(env.houses, () => world.now).execute(user, house.id, users.marina.id);
  const after = env.store.read((s) => s);
  assert.ok(!after.houseMemberships.some((m) => m.houseID === house.id && m.userID === user));
  const rooms = new Set(after.rooms.filter((r) => r.houseID === house.id).map((r) => r.id));
  assert.ok(!after.roomMemberships.some((m) => rooms.has(m.roomID) && m.userID === user && isCurrentMember(m)));
  assert.ok(after.users.some((u) => u.id === user));
  assert.ok(before.occurrences.filter(isCompleted).every((o) => after.occurrences.some((x) => JSON.stringify(x) === JSON.stringify(o))));
});

test("não é possível remover o próprio perfil", async () => {
  const { world, env, house, users } = setup();
  await assert.rejects(
    new RemoveHouseMemberUseCase(env.houses, () => world.now).execute(users.marina.id, house.id, users.marina.id),
    code("cannotRemoveCurrentUser"),
  );
  assert.ok((await env.houses.memberIDs(house.id)).includes(users.marina.id));
});

test("o cômodo salva aparência, nome aparado e moradores escolhidos", async () => {
  const { world, env, house } = setup();
  const members = await env.houses.members(house.id);
  const creator = members[0];
  const second = members[1];
  assert.ok(creator !== undefined && second !== undefined);
  const room = await new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID).execute({
    name: "  Quarto azul  ", houseID: house.id, creatorUserID: creator.id, visibility: "privateRoom",
    responsibleCount: members.length, icon: "bed.double.fill", color: "purple",
    selectedParticipantIDs: new Set([creator.id, second.id]),
  });
  const stored = await env.rooms.room(room.id, creator.id);
  assert.equal(stored.name, "Quarto azul");
  assert.equal(stored.responsibleCount, members.length);
  assert.equal(stored.icon, "bed.double.fill");
  assert.equal(stored.color, "purple");
  const participation = await env.rooms.participation(room.id, second.id, world.now);
  assert.ok(participation.isMember);
  assert.equal(participation.memberCount, 2);
});

test("cômodo privado começa só com o criador", async () => {
  const { world, env, house, users } = setup();
  const room = await new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID).execute({
    name: "Quarto", houseID: house.id, creatorUserID: users.marina.id, visibility: "privateRoom",
  });
  const info = await env.rooms.participation(room.id, users.marina.id, world.now);
  assert.equal(info.memberCount, 1);
  assert.ok(info.isMember);
});

test("o cômodo exige nome e participantes válidos", async () => {
  const { world, env, house, users } = setup();
  const useCase = new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID);
  await assert.rejects(useCase.execute({ name: "  ", houseID: house.id, creatorUserID: users.marina.id, visibility: "common" }), code("invalidRoomName"));
  await assert.rejects(
    useCase.execute({ name: "X", houseID: house.id, creatorUserID: users.marina.id, visibility: "privateRoom", selectedParticipantIDs: new Set([users.leo.id]) }),
    code("invalidRoomParticipants"),
  );
  await assert.rejects(
    useCase.execute({ name: "X", houseID: house.id, creatorUserID: users.marina.id, visibility: "common", responsibleCount: 0 }),
    code("invalidSchedule"),
  );
});

test("os cômodos de demonstração têm ícones e cores distintos", () => {
  const rooms = Object.values(new World().seed.rooms);
  assert.equal(new Set(rooms.map((r) => r.icon)).size, rooms.length);
  assert.equal(new Set(rooms.map((r) => r.color)).size, rooms.length);
});

test("remover da casa não depende da ordem em que os cômodos são percorridos", () => {
  // Percorre os cômodos em ordem crescente e decrescente de ID e compara os estados resultantes.
  const outcomes = [false, true].map((reverse) => {
    const world = new World({ timezone: "America/Sao_Paulo" });
    const { users, house } = world.seed;
    const state = cloneStoreState(world.seed.state);
    const service = world.service();
    const date = world.now;
    const rooms = state.rooms.filter((r) => r.houseID === house.id).map((r) => r.id).sort();
    for (const roomID of reverse ? rooms.reverse() : rooms) {
      service.removeMember(users.rafa.id, roomID, date, state, { confirmDeletion: true, houseChange: true, replan: false });
    }
    state.houseMemberships = state.houseMemberships.filter((m) => m.userID !== users.rafa.id);
    service.rebalance(house.id, service.addingWeeks(1, service.weekStart(date)), date, state);
    // Normaliza os IDs gerados na execução: só a estrutura importa.
    const known = new Set(JSON.stringify(world.seed.state).match(/[0-9a-f-]{36}/g));
    const ids = new Map<string, string>();
    return JSON.stringify(state, (_k, v: unknown) => {
      if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) && !known.has(v)) {
        if (!ids.has(v)) ids.set(v, `new-${ids.size + 1}`);
        return ids.get(v);
      }
      return v;
    });
  });
  const [ascending, descending] = outcomes;
  assert.ok(ascending !== undefined && descending !== undefined);
  assert.equal(JSON.parse(ascending).occurrences.length, JSON.parse(descending).occurrences.length);
  assert.deepEqual(JSON.parse(ascending).rooms, JSON.parse(descending).rooms);
  assert.deepEqual(JSON.parse(ascending).roomMemberships, JSON.parse(descending).roomMemberships);
  assert.deepEqual(JSON.parse(ascending).definitions, JSON.parse(descending).definitions);
});

test("o perfil lista os moradores ordenados por nome", async () => {
  const { env, house, users } = setup();
  const members = await new GetHouseMembersUseCase(env.houses).execute(house.id, users.marina.id);
  assert.deepEqual(members.map((u) => u.name), ["Bia", "Leo", "Marina", "Rafa"]);
});
