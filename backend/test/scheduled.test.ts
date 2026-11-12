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
    houseIDs: async () => [a, b, c], now: () => 7, onFailure: (d) => failures.push(d),
    emit: async (id, at) => { assert.equal(at, 7); if (id === b) throw new RangeError("x"); return id === a ? 2 : 3; },
  });
  assert.deepEqual(await handler({}), { houses: 3, created: 5, failures: 1 });
  assert.deepEqual(failures, ["RangeError"], "só o nome do erro");
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
