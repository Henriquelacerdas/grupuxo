import assert from "node:assert/strict";
import { test } from "node:test";
import { listHouseIDs } from "../src/adapters/dynamodb/house-lister.ts";
import { createScheduledHandler } from "../src/lambdas/scheduled.ts";
import { dynamoApiEnv, inMemoryApiEnv, type ApiEnv } from "./lambdas/api-support.ts";
import { bodyOf, expectStatus, list, rec, text, twoHousesScenario } from "./lambdas/api-routes-helpers.ts";
import { FakeDynamoClient } from "./support/fake-dynamo-client.ts";
import { houseID } from "../src/domain/ids.ts";
import { uuid } from "./support/world.ts";

test("o handler agendado percorre as casas, soma os avisos e isola a que falha", async () => {
  const a = houseID(uuid(1)), b = houseID(uuid(2)), c = houseID(uuid(3));
  const failures: string[] = [];
  const handler = createScheduledHandler({
    houseIDs: async () => [a, b, c], now: () => 7, onFailure: (d) => failures.push(d), concurrency: 1,
    emit: async (id, at) => { assert.equal(at, 7); if (id === b) throw new RangeError("x"); return id === a ? 2 : 3; },
  });
  assert.deepEqual(await handler({}), { houses: 3, created: 5, reminded: 0, failures: 1, skipped: 0 });
  assert.deepEqual(failures, ["RangeError"], "só o nome do erro");
});

test("o handler agendado processa as casas em paralelo, sem passar do limite de concorrência", async () => {
  const ids = Array.from({ length: 20 }, (_, n) => houseID(uuid(n + 1)));
  let running = 0, peak = 0;
  const seen = new Set<string>();
  const handler = createScheduledHandler({
    houseIDs: async () => ids, now: () => 0, onFailure: () => {}, concurrency: 4,
    emit: async (id) => {
      running += 1; peak = Math.max(peak, running); seen.add(id);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return 1;
    },
  });
  assert.deepEqual(await handler({}), { houses: 20, created: 20, reminded: 0, failures: 0, skipped: 0 });
  assert.equal(seen.size, 20, "cada casa uma vez");
  assert.equal(peak, 4, "usa toda a concorrência e não passa dela");
});

test("o lembrete diário roda depois dos avisos de cada casa e soma os pushes", async () => {
  const a = houseID(uuid(1)), b = houseID(uuid(2));
  const order: string[] = [];
  const handler = createScheduledHandler({
    houseIDs: async () => [a, b], now: () => 0, onFailure: () => {}, concurrency: 1,
    emit: async (id) => { order.push(`emit ${id}`); return 1; },
    remind: async (id) => { order.push(`remind ${id}`); return id === a ? 2 : 0; },
  });
  assert.deepEqual(await handler({}), { houses: 2, created: 2, reminded: 2, failures: 0, skipped: 0 });
  assert.deepEqual(order, [`emit ${a}`, `remind ${a}`, `emit ${b}`, `remind ${b}`]);
});

test("sem casas, o handler agendado não faz nada", async () => {
  const handler = createScheduledHandler({ houseIDs: async () => [], now: () => 0, onFailure: () => {}, concurrency: 8, emit: async () => 1 });
  assert.deepEqual(await handler({}), { houses: 0, created: 0, reminded: 0, failures: 0, skipped: 0 });
});

test("a concorrência do handler agendado precisa ser um inteiro positivo", () => {
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createScheduledHandler({ houseIDs: async () => [], now: () => 0, onFailure: () => {}, concurrency, emit: async () => 0 }), RangeError);
  }
});

test("estourado o orçamento de tempo, o handler agendado para de começar casas e conta as que ficaram", async () => {
  const ids = Array.from({ length: 10 }, (_, n) => houseID(uuid(n + 1)));
  let clock = 0;
  const done: string[] = [];
  const handler = createScheduledHandler({
    houseIDs: async () => ids, now: () => clock, onFailure: () => {}, concurrency: 1, timeBudgetMs: 25,
    emit: async (id) => { done.push(id); clock += 10; return 0; },
  });
  // Começa em 0, 10 e 20 (< 25); no 30 o orçamento acabou.
  assert.deepEqual(await handler({}), { houses: 10, created: 0, reminded: 0, failures: 0, skipped: 7 });
  assert.equal(done.length, 3);
});

test("o handler agendado começa numa casa diferente a cada hora, para ninguém ficar sempre no fim da fila", async () => {
  const ids = Array.from({ length: 5 }, (_, n) => houseID(uuid(n + 1)));
  const firstOf = async (hour: number): Promise<string | undefined> => {
    const order: string[] = [];
    await createScheduledHandler({
      houseIDs: async () => ids, now: () => hour * 3_600_000 + 5, onFailure: () => {}, concurrency: 1,
      emit: async (id) => { order.push(id); return 0; },
    })({});
    assert.equal(new Set(order).size, 5, "todas, uma vez");
    return order[0];
  };
  const starts = await Promise.all([0, 1, 2, 3, 4, 5].map(firstOf));
  assert.equal(new Set(starts.slice(0, 5)).size, 5, "cinco horas seguidas, cinco inícios diferentes");
  assert.equal(starts[5], starts[0], "e volta ao começo");
});

test("listHouseIDs enumera só os itens META, em todas as páginas", async () => {
  const client = new FakeDynamoClient({ pageSize: 2 });
  for (let n = 1; n <= 5; n += 1) {
    await client.put({ item: { PK: `HOUSE#${uuid(n)}`, SK: "META", name: "x" } });
    await client.put({ item: { PK: `HOUSE#${uuid(n)}`, SK: `ROOM#${uuid(n + 50)}`, name: "y" } });
  }
  assert.deepEqual(await listHouseIDs(client), [1, 2, 3, 4, 5].map((n) => houseID(uuid(n))));
});

for (const [name, make] of [["em memória", inMemoryApiEnv], ["DynamoDB", dynamoApiEnv]] as const) {
  test(`${name}: o ciclo que vira avisa quem cuida do cômodo, uma vez só; o resumo avisa quem cuidou`, async () => {
    const env: ApiEnv = make();
    const { house } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const room = bodyOf(await env.call("ana", "GET", `/v1/rooms/${roomID}`));
    const periodEnd = Date.parse(text(room["periodEnd"]));
    const kinds = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/notifications"))["notifications"]).map(rec).map((n) => n["kind"]);
    const emit = (at: number) => env.emitScheduled(houseID(house.id), at);

    assert.equal(await emit(env.clock), 0, "no primeiro ciclo ainda nada virou");
    // O ciclo virou: quem passa a cuidar do cômodo é avisado, uma vez (repetir não duplica).
    const turned = await emit(periodEnd + 3_600_000);
    assert.equal(turned, 1);
    assert.equal(await emit(periodEnd + 2 * 3_600_000), 0);
    const all = [...(await kinds("ana")), ...(await kinds("bia"))];
    assert.equal(all.filter((k) => k === "cycleTurned").length, 1);
    const turnedNotice = [...list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]), ...list(bodyOf(await env.call("bia", "GET", "/v1/me/notifications"))["notifications"])]
      .map(rec).find((n) => n["kind"] === "cycleTurned");
    assert.ok(turnedNotice !== undefined);
    assert.ok(Date.parse(text(turnedNotice["dueAt"])) > periodEnd, "até quando vale o novo ciclo");
    assert.deepEqual(turnedNotice["names"], [], "só uma pessoa cuida do cômodo: ninguém mais na segunda linha");
    // Janela de avaliação fechada: quem cuidou do ciclo anterior tem resumo (com 1 voto) e é avisado uma vez.
    const rater = list(bodyOf(await env.call("ana", "GET", "/v1/me/ratings/pending"))["pending"]).length > 0 ? "ana" : "bia";
    env.clock = periodEnd + 12 * 3_600_000;
    expectStatus(await env.call(rater, "POST", `/v1/rooms/${roomID}/ratings`, { body: JSON.stringify({ periodStart: text(room["periodStart"]), level: "good", tags: [] }) }), 204);
    const summarized = await emit(periodEnd + 3 * 24 * 3_600_000);
    assert.equal(summarized, 1);
    assert.equal(await emit(periodEnd + 3 * 24 * 3_600_000 + 1000), 0);
    const kindsAfter = [...(await kinds("ana")), ...(await kinds("bia"))];
    assert.equal(kindsAfter.filter((k) => k === "weeklySummaryReady").length, 1);
  });
}

for (const [name, make] of [["em memória", inMemoryApiEnv], ["DynamoDB", dynamoApiEnv]] as const) {
  test(`${name}: pendências por morador = Minhas tarefas sem as concluídas`, async () => {
    const env: ApiEnv = make();
    const { house, ids } = await twoHousesScenario(env);
    const counts = await env.pendingTasks(houseID(house.id), env.clock);
    const mine = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map(rec)
      .filter((t) => rec(t["occurrence"])["completedAt"] === null).length;
    assert.equal(counts.timezone.length > 0, true);
    assert.deepEqual(counts.members.map((m) => m.userID), [ids.ana, ids.bia].sort());
    for (const member of counts.members) assert.equal(member.pending, await mine(member.userID === ids.ana ? "ana" : "bia"));
  });
}
