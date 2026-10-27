import assert from "node:assert/strict";
import { test } from "node:test";
import { houseSnapshot } from "../src/domain/commands/house-snapshot.ts";
import { houseMembers } from "../src/domain/commands/houses.ts";
import { roomParticipation, roomsFor } from "../src/domain/commands/rooms.ts";
import { refreshSchedule, roomTasks, sporadicTasks, userTasks } from "../src/domain/commands/tasks.ts";
import { createCalendar } from "../src/domain/dates.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { userID } from "../src/domain/ids.ts";
import { cloneStoreState } from "../src/domain/store-state.ts";
import { dynamoEnvironment } from "./dynamodb/environment.ts";
import { FakeDynamoClient } from "./support/fake-dynamo-client.ts";
import { World, uuid } from "./support/world.ts";

test("snapshot equivale às consultas individuais para todos os moradores, inclusive cômodos privados", () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const state = cloneStoreState(world.seed.state);
  refreshSchedule(world.ctx, state, world.seed.house.id, world.now);
  for (const user of state.users) {
    const houseID = world.seed.house.id;
    const snapshot = houseSnapshot(world.ctx, state, houseID, user.id, world.now);
    const rooms = roomsFor(state, houseID, user.id);
    assert.deepEqual(snapshot.members, houseMembers(state, houseID));
    assert.deepEqual(snapshot.rooms, rooms);
    assert.deepEqual(snapshot.participations, rooms.map((room) => roomParticipation(world.ctx, state, room.id, user.id, world.now)));
    assert.deepEqual(snapshot.myTasks, userTasks(state, user.id, houseID, world.now));
    assert.deepEqual(snapshot.sporadicTasks, sporadicTasks(world.ctx, state, houseID, user.id, world.now));
    assert.deepEqual(snapshot.roomTasks, rooms.flatMap((room) => roomTasks(state, room.id, user.id)));
    for (const participation of snapshot.participations.filter((p) => !p.isMember)) {
      assert.deepEqual(participation.room.scheduleVersions, []);
      assert.deepEqual(participation.responsibleNames, []);
      assert.equal(participation.memberCount, 0);
    }
  }
  assert.throws(
    () => houseSnapshot(world.ctx, state, world.seed.house.id, userID(uuid(9999)), world.now),
    (error: unknown) => isDomainError(error, "entityNotFound"),
  );
});

test("snapshot usa uma única carga da partição; escala em dia não grava e uma semana nova é persistida", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = await dynamoEnvironment(world, world.seed.state, new FakeDynamoClient({ pageSize: 5000 }));
  const house = world.seed.house.id;
  const me = world.seed.users.marina.id;
  await env.tasks.tasks(me, house);
  const queries = env.client.reads.query;
  const batches = env.client.reads.batchGet;
  const writes = env.client.writes;
  const before = env.client.snapshot();
  const result = await env.tasks.snapshot(house, me, world.now);
  assert.equal(result.userID, me);
  assert.equal(env.client.reads.query - queries, 1);
  assert.equal(env.client.reads.batchGet - batches, 1);
  assert.equal(env.client.writes, writes);
  assert.deepEqual(env.client.snapshot(), before);
  world.now = createCalendar(world.timezone).addWeeks(world.now, 1);
  await env.tasks.snapshot(house, me, world.now);
  assert.equal(env.client.writes, writes + 1);
  await env.tasks.snapshot(house, me, world.now);
  assert.equal(env.client.writes, writes + 1);
});

test("alterar os arrays de read não altera a leitura seguinte nem vira escrita", async () => {
  const world = new World();
  const env = await dynamoEnvironment(world);
  const writes = env.client.writes;
  await env.store.read(world.seed.house.id, (state) => { state.occurrences = []; state.users.pop(); });
  const state = await env.state();
  assert.equal(state.occurrences.length, world.seed.state.occurrences.length);
  assert.equal(state.users.length, world.seed.state.users.length);
  assert.equal(env.client.writes, writes);
});
