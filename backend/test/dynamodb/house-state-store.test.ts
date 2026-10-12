import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ATTEMPTS, HouseStateStore, type DynamoRuntime } from "../../src/adapters/dynamodb/house-state-store.ts";
import { DynamoTransactionCanceledError } from "../../src/adapters/dynamodb/client.ts";
import { DynamoStoreError } from "../../src/adapters/dynamodb/errors.ts";
import { ACCESS_CODE_ATTEMPTS } from "../../src/domain/commands/houses.ts";
import { DynamoTaskRepository, DynamoHouseRepository } from "../../src/adapters/dynamodb/repositories.ts";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import { InMemoryTaskRepository } from "../../src/adapters/in-memory/repositories.ts";
import { isDomainError } from "../../src/domain/errors.ts";
import { isCompleted } from "../../src/domain/entities.ts";
import { houseMembershipID, taskOccurrenceID, userID } from "../../src/domain/ids.ts";
import { dynamoEnvironment, instantRuntime } from "./environment.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { sequentialAccessCodes } from "../support/state-json.ts";
import { uuid, World } from "../support/world.ts";

const SAO_PAULO = "America/Sao_Paulo";
const version = (client: FakeDynamoClient, houseID: string): unknown => client.peek({ PK: `HOUSE#${houseID}`, SK: "META" })?.["version"];

async function openTask(world: World, env: Awaited<ReturnType<typeof dynamoEnvironment>>) {
  const { users, house } = world.seed;
  const open = (await env.tasks.tasks(users.marina.id, house.id)).find((item) => !isCompleted(item.occurrence));
  assert.ok(open !== undefined);
  return open.occurrence.id;
}

test("conclusões concorrentes da mesma tarefa: uma grava, a outra recarrega e não repete o efeito", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const id = await openTask(world, env);
  const startVersion = version(env.client, house.id);
  const writes = env.client.transactions.length;

  await Promise.all([env.tasks.complete(id, users.marina.id, world.now), env.tasks.complete(id, users.marina.id, world.now)]);

  const expected = (() => {
    const reference = new World({ timezone: SAO_PAULO });
    const store = new InMemoryStore(reference.seed.state);
    return { reference, tasks: new InMemoryTaskRepository(store, reference.ctx), store };
  })();
  const refOpen = (await expected.tasks.tasks(users.marina.id, house.id)).find((item) => !isCompleted(item.occurrence));
  assert.ok(refOpen !== undefined);
  await expected.tasks.complete(refOpen.occurrence.id, users.marina.id, expected.reference.now);

  const state = await env.state();
  assert.equal(state.occurrences.find((o) => o.id === id)?.status, "completed");
  // O saldo de justiça é o de uma única conclusão (nada duplicado pela segunda tentativa).
  assert.deepEqual(state.roomMemberships.map((m) => m.fairnessDebt), expected.store.read((s) => s.roomMemberships.map((m) => m.fairnessDebt)));
  assert.equal(env.client.transactions.length - writes, 1);
  assert.equal(version(env.client, house.id), typeof startVersion === "number" ? startVersion + 1 : -1);
});

test("comandos concorrentes diferentes na mesma casa: os dois são aplicados, um depois do outro", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const done = await openTask(world, env);
  const [sporadic] = await env.tasks.sporadicTasks(house.id, users.leo.id);
  assert.ok(sporadic !== undefined);
  const startVersion = version(env.client, house.id);
  assert.equal(typeof startVersion, "number");

  await Promise.all([
    env.tasks.complete(done, users.marina.id, world.now),
    env.tasks.claim(sporadic.occurrence.id, users.leo.id, world.now),
  ]);

  const state = await env.state();
  assert.equal(state.occurrences.find((o) => o.id === done)?.status, "completed");
  assert.equal(state.occurrences.find((o) => o.id === sporadic.occurrence.id)?.status, "assigned");
  assert.equal(version(env.client, house.id), typeof startVersion === "number" ? startVersion + 2 : -1);
});

test("conflito persistente: depois de MAX_ATTEMPTS desiste, não grava nada e não aplica parcial", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const id = await openTask(world, env);
  const before = env.client.snapshot();
  let attempts = 0;
  // Outro escritor muda a versão antes de cada tentativa.
  env.client.beforeTransact = async () => {
    attempts += 1;
    const meta = env.client.peek({ PK: `HOUSE#${house.id}`, SK: "META" });
    assert.ok(meta !== undefined);
    env.client.seedItem({ ...meta, version: Number(meta["version"]) + 1 });
  };
  await assert.rejects(env.tasks.complete(id, users.marina.id, world.now), (error: unknown) => error instanceof DynamoStoreError && error.code === "conflict");
  assert.equal(attempts, MAX_ATTEMPTS);
  env.client.beforeTransact = undefined;
  const after = env.client.snapshot();
  const changed = after.filter((item, index) => JSON.stringify(item) !== JSON.stringify(before[index]));
  assert.deepEqual(changed.map((item) => item["SK"]), ["META"]);
});

test("cancelamento que não é da versão não é repetido e propaga", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users } = world.seed;
  const id = await openTask(world, env);
  let attempts = 0;
  env.client.beforeTransact = async () => {
    attempts += 1;
    throw new DynamoTransactionCanceledError(["Other", "ConditionalCheckFailed"]);
  };
  await assert.rejects(env.tasks.complete(id, users.marina.id, world.now), DynamoTransactionCanceledError);
  assert.equal(attempts, 1);
});

test("comando sem diferença não grava nada (consulta que só confere a escala)", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  await env.tasks.tasks(users.marina.id, house.id);
  const writes = env.client.writes;
  const snapshot = env.client.snapshot();
  await env.tasks.tasks(users.marina.id, house.id);
  await env.tasks.refreshSchedule(house.id, world.now);
  await env.tasks.sporadicTasks(house.id, users.leo.id);
  assert.equal(env.client.writes, writes);
  assert.deepEqual(env.client.snapshot(), snapshot);
});

test("comando rejeitado pelo domínio não grava nada", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const writes = env.client.writes;
  await assert.rejects(env.houses.removeMember(users.marina.id, house.id, users.marina.id, world.now, false), (error: unknown) => isDomainError(error, "cannotRemoveCurrentUser"));
  assert.equal(env.client.writes, writes);
});

test("escritas demais para uma transação: falha fechada, sem gravar em partes", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const before = env.client.snapshot();
  // Trocar um morador replaneja a escala inteira da demonstração: mais de 100 itens mudam (BACKEND.md seção 4).
  await assert.rejects(env.houses.addMember("Nova", house.id, users.marina.id, world.now), (error: unknown) => error instanceof DynamoStoreError && error.code === "tooManyWrites");
  assert.deepEqual(env.client.snapshot(), before);
});

test("casa inexistente: leitura devolve o erro do domínio e escrita não grava", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const stranger = uuid(900);
  const writes = env.client.writes;
  await assert.rejects(env.houses.members(world.seed.house.id.replace(/.$/, "f") as never), (error: unknown) => isDomainError(error, "entityNotFound"));
  await env.tasks.refreshSchedule(houseIdOf(stranger), world.now);
  await assert.rejects(env.tasks.addMember(world.seed.users.leo.id, roomIdOf(901), world.now), (error: unknown) => isDomainError(error, "entityNotFound"));
  assert.equal(env.client.writes, writes);
});

import { houseID, roomID } from "../../src/domain/ids.ts";
function houseIdOf(value: string) {
  return houseID(value);
}
function roomIdOf(n: number) {
  return roomID(uuid(n));
}

test("a casa de uma entidade pelo ID: o GSI atrasado é consultado de novo, depois falha fechado", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users } = world.seed;
  const id = await openTask(world, env);
  const key = { PK: `HOUSE#${world.seed.house.id}`, SK: `OCC#${id}` };
  const indexed = env.client.peek(key);
  assert.ok(indexed !== undefined);
  const { GSI1PK: _pk, GSI1SK: _sk, ...unindexed } = indexed;
  env.client.seedItem(unindexed);

  // Sem o índice e sem recuperação: não encontra, e nada é gravado.
  const writes = env.client.writes;
  await assert.rejects(env.tasks.complete(id, users.marina.id, world.now), (error: unknown) => isDomainError(error, "entityNotFound"));
  assert.equal(env.client.writes, writes);

  // O índice "alcança" durante a espera entre as duas buscas.
  const catchingUp: DynamoRuntime = { random: () => 0, sleep: async () => { env.client.seedItem(indexed); } };
  const store = new HouseStateStore(env.client, catchingUp);
  await new DynamoTaskRepository(store, world.ctx).complete(id, users.marina.id, world.now);
  assert.equal((await env.state()).occurrences.find((o) => o.id === id)?.status, "completed");
});

test("item corrompido falha fechado com mensagem fixa, sem vazar o valor", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const { users, house } = world.seed;
  const id = await openTask(world, env);
  const key = { PK: `HOUSE#${house.id}`, SK: `OCC#${id}` };
  const item = env.client.peek(key);
  assert.ok(item !== undefined);
  env.client.seedItem({ ...item, status: "valor-secreto-inesperado" });
  await assert.rejects(env.tasks.tasks(users.marina.id, house.id), (error: unknown) => {
    assert.ok(error instanceof DynamoStoreError);
    assert.equal(error.code, "invalidItem");
    assert.ok(!error.message.includes("valor-secreto-inesperado"));
    return true;
  });
  env.client.seedItem({ ...item, taskDefinitionID: "não-é-uuid" });
  await assert.rejects(env.state(), (error: unknown) => error instanceof DynamoStoreError && error.code === "invalidItem");
});

test("casa grande: pagina a partição e busca os perfis em lotes de 100", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const state = world.cleanState();
  for (let n = 0; n < 130; n += 1) {
    const id = userID(uuid(1000 + n));
    state.users.push({ id, name: `Morador ${n}`, email: null });
    state.houseMemberships.push({ id: houseMembershipID(uuid(2000 + n)), houseID: world.seed.house.id, userID: id });
  }
  const env = await dynamoEnvironment(world, state);
  assert.equal((await env.houses.members(world.seed.house.id)).length, 134);
  assert.equal(env.client.reads.batchGet, 2);
  assert.ok(env.client.reads.query > 10);
});

test("semear: ID ou código de acesso repetidos falham antes de gravar qualquer item", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const writes = env.client.writes;
  await assert.rejects(env.store.seedHouse(world.seed.state), (error: unknown) => error instanceof DynamoStoreError && error.code === "houseExists");
  const other = new World({ timezone: SAO_PAULO });
  const clone = { ...other.cleanState(), houses: [{ ...other.seed.house, id: houseID(uuid(950)) }] };
  await assert.rejects(env.store.seedHouse(clone), (error: unknown) => error instanceof DynamoStoreError && error.code === "accessCodeTaken");
  assert.equal(env.client.writes, writes);
});

test("a casa só aparece quando o META é publicado: itens órfãos de uma carga interrompida não a criam", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const client = new FakeDynamoClient();
  const store = new HouseStateStore(client, instantRuntime);
  client.failNext = { operation: "transactWrite", error: new Error("queda de rede") };
  await assert.rejects(store.seedHouse(world.seed.state), /queda de rede/);
  const houses = new DynamoHouseRepository(store, client, world.ctx, sequentialAccessCodes());
  await assert.rejects(houses.house(world.seed.house.id), (error: unknown) => isDomainError(error, "entityNotFound"));
  assert.deepEqual(await houses.houses(world.seed.users.marina.id), []);
  // Repetir a carga completa funciona (itens órfãos são sobrescritos).
  await store.seedHouse(world.seed.state);
  assert.equal((await houses.house(world.seed.house.id)).id, world.seed.house.id);
});

test("criar casa: com o código sempre ocupado desiste depois das tentativas, sem publicar a casa", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world);
  const founder = userID(uuid(901));
  await env.registerUser({ id: founder, name: "Fundadora", email: null });
  let generated = 0;
  const houses = new DynamoHouseRepository(env.store, env.client, world.ctx, () => { generated += 1; return "GRUPUXO"; });
  await assert.rejects(
    houses.create(founder, "Casa nova", SAO_PAULO, world.now),
    (error: unknown) => error instanceof DynamoStoreError && error.code === "accessCodeTaken",
  );
  assert.equal(generated, ACCESS_CODE_ATTEMPTS);
  assert.deepEqual(await houses.houses(founder), []);
});

test("entrar por código: o perfil de quem entra é carregado e não regravado; sem o perfil falha fechado", async () => {
  const world = new World({ timezone: SAO_PAULO });
  const env = await dynamoEnvironment(world, world.cleanState());
  const newcomer = userID(uuid(902));
  await env.registerUser({ id: newcomer, name: "Nova", email: null });
  const transactions = env.client.transactions.length;
  await env.houses.joinByCode(newcomer, "GRUPUXO", world.now);
  const written = env.client.transactions.slice(transactions).flat();
  assert.ok(written.length > 0);
  assert.ok(!written.some((action) => action.kind === "put" && action.item["SK"] === "PROFILE"));
  assert.ok(written.some((action) => action.kind === "put" && String(action.item["SK"]).startsWith("MEMBER#")));

  const writes = env.client.writes;
  await assert.rejects(env.houses.joinByCode(userID(uuid(903)), "GRUPUXO", world.now), (error: unknown) => isDomainError(error, "entityNotFound"));
  assert.equal(env.client.writes, writes);
});

void taskOccurrenceID;
