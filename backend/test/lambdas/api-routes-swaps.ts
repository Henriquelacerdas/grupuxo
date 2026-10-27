import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnv, ApiEnvFactory, Who } from "./api-support.ts";
import { WEEKLY_TASK, bodyOf, expectError, expectStatus, list, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

// Rotas de tarefa avulsa, troca e notificação (BACKEND.md, seção 6.1): GET /v1/me/sporadic-tasks,
// POST /v1/occurrences/{id}/claim e /release, GET /v1/occurrences/{id}/swap-candidates, POST /v1/swaps, GET /v1/me/swaps,
// POST /v1/swaps/{id}/accept e /reject, GET /v1/me/notifications e POST /v1/notifications/{id}/read.

const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const WEEK = 7 * 24 * 3_600_000;
const DAILY_TASK = {
  ...WEEKLY_TASK, name: "Tirar o lixo", recurrence: { kind: "recurring", frequency: "daily", interval: 1 },
} as const;
const SPORADIC_TASK = {
  name: "Trocar lâmpada", details: "", effort: 1, kind: "sporadic", recurrence: { kind: "none" }, assignmentPolicy: "selfAssigned",
} as const;

async function myOccurrenceIDs(env: ApiEnv, who: Who): Promise<string[]> {
  return list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map((item) => text(rec(rec(item)["occurrence"])["id"]));
}

/** Uma tarefa diária na "Casa toda", dividida pela escala entre Ana e Bia: devolve uma ocorrência de cada. */
async function oneTaskEach(env: ApiEnv, roomID: string): Promise<{ readonly ana: string; readonly bia: string }> {
  expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(DAILY_TASK) }), 201);
  env.clock += WEEK;
  const [ana] = await myOccurrenceIDs(env, "ana");
  const [bia] = await myOccurrenceIDs(env, "bia");
  assert.ok(ana !== undefined && bia !== undefined, "a escala deveria dar uma tarefa para cada uma");
  return { ana, bia };
}

async function sporadicOccurrence(env: ApiEnv, roomID: string): Promise<string> {
  expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(SPORADIC_TASK) }), 201);
  const [item] = list(bodyOf(await env.call("ana", "GET", "/v1/me/sporadic-tasks"))["tasks"]).map(rec);
  assert.ok(item !== undefined);
  return text(rec(item["occurrence"])["id"]);
}

async function sporadicStatus(env: ApiEnv, who: Who): Promise<unknown> {
  const [item] = list(bodyOf(await env.call(who, "GET", "/v1/me/sporadic-tasks"))["tasks"]).map(rec);
  return item === undefined ? undefined : rec(item["occurrence"])["status"];
}

export function swapAndSporadicRoutes(name: string, make: ApiEnvFactory): void {
  test(`${name}: avulsa: lista da casa, assumir e devolver`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const id = await sporadicOccurrence(env, house.wholeHouseRoomID);
    assert.equal(await sporadicStatus(env, "bia"), "available");
    assert.equal((await env.call("bia", "POST", `/v1/occurrences/${id}/claim`)).statusCode, 204);
    assert.equal(await sporadicStatus(env, "ana"), "assigned");
    // Devolver a avulsa de outra pessoa não faz nada (idempotente, como no domínio).
    assert.equal((await env.call("ana", "POST", `/v1/occurrences/${id}/release`)).statusCode, 204);
    assert.equal(await sporadicStatus(env, "ana"), "assigned");
    assert.equal((await env.call("bia", "POST", `/v1/occurrences/${id}/release`)).statusCode, 204);
    assert.equal(await sporadicStatus(env, "ana"), "available");
    assert.deepEqual(list(bodyOf(await env.call("caio", "GET", "/v1/me/sporadic-tasks"))["tasks"]), []);
  });

  test(`${name}: avulsa de outra casa ou inexistente: 404 igual, sem alterar nada`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const id = await sporadicOccurrence(env, house.wholeHouseRoomID);
    const before = JSON.stringify(env.snapshot());
    for (const action of ["claim", "release"]) {
      expectError(await env.call("caio", "POST", `/v1/occurrences/${id}/${action}`), 404, "not_found");
      expectError(await env.call("ana", "POST", `/v1/occurrences/${UNKNOWN}/${action}`), 404, "not_found");
    }
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: troca: candidatas, pedido, notificação, aceite e leitura`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const mine = await oneTaskEach(env, house.wholeHouseRoomID);

    const candidates = list(bodyOf(await env.call("ana", "GET", `/v1/occurrences/${mine.ana}/swap-candidates`))["tasks"])
      .map((item) => text(rec(rec(item)["occurrence"])["id"]));
    assert.ok(candidates.includes(mine.bia));

    const created = expectStatus(await env.call("ana", "POST", "/v1/swaps", {
      body: JSON.stringify({ offeredOccurrenceID: mine.ana, requestedOccurrenceID: mine.bia }),
    }), 201);
    assert.deepEqual(
      [created["requesterID"], created["receiverID"], created["status"], created["resolvedAt"]],
      [ids.ana, ids.bia, "pending", null],
    );
    const swapID = text(created["id"]);

    const biaSwaps = bodyOf(await env.call("bia", "GET", "/v1/me/swaps"));
    assert.deepEqual(list(biaSwaps["incoming"]), [created]);
    assert.deepEqual(list(biaSwaps["outgoing"]), []);
    assert.deepEqual(list(bodyOf(await env.call("ana", "GET", "/v1/me/swaps"))["outgoing"]), [created]);

    const [requested] = list(bodyOf(await env.call("bia", "GET", "/v1/me/notifications"))["notifications"]).map(rec);
    assert.ok(requested !== undefined);
    assert.deepEqual([requested["kind"], requested["swapRequestID"], requested["readAt"]], ["taskSwapRequested", swapID, null]);

    // Quem pediu não responde o próprio pedido.
    expectError(await env.call("ana", "POST", `/v1/swaps/${swapID}/accept`), 403, "task_unavailable");

    const accepted = expectStatus(await env.call("bia", "POST", `/v1/swaps/${swapID}/accept`), 200);
    assert.equal(accepted["status"], "accepted");
    assert.equal(typeof accepted["resolvedAt"], "string");
    assert.ok((await myOccurrenceIDs(env, "ana")).includes(mine.bia));
    assert.ok((await myOccurrenceIDs(env, "bia")).includes(mine.ana));

    const [answer] = list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec);
    assert.ok(answer !== undefined);
    assert.equal(answer["kind"], "taskSwapAccepted");
    const notificationID = text(answer["id"]);
    expectError(await env.call("bia", "POST", `/v1/notifications/${notificationID}/read`), 404, "not_found");
    assert.equal((await env.call("ana", "POST", `/v1/notifications/${notificationID}/read`)).statusCode, 204);
    const [read] = list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec);
    assert.equal(typeof read?.["readAt"], "string");
  });

  test(`${name}: troca recusada mantém as tarefas com quem estavam`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const mine = await oneTaskEach(env, house.wholeHouseRoomID);
    const swapID = text(expectStatus(await env.call("ana", "POST", "/v1/swaps", {
      body: JSON.stringify({ offeredOccurrenceID: mine.ana, requestedOccurrenceID: mine.bia }),
    }), 201)["id"]);
    assert.equal(expectStatus(await env.call("bia", "POST", `/v1/swaps/${swapID}/reject`), 200)["status"], "rejected");
    assert.ok((await myOccurrenceIDs(env, "ana")).includes(mine.ana));
    expectError(await env.call("bia", "POST", `/v1/swaps/${swapID}/accept`), 403, "task_unavailable");
  });

  test(`${name}: troca com ocorrência ou pedido de outra casa: 404 igual, sem alterar nada`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const mine = await oneTaskEach(env, house.wholeHouseRoomID);
    const swapID = text(expectStatus(await env.call("ana", "POST", "/v1/swaps", {
      body: JSON.stringify({ offeredOccurrenceID: mine.ana, requestedOccurrenceID: mine.bia }),
    }), 201)["id"]);
    const before = JSON.stringify(env.snapshot());
    expectError(await env.call("caio", "GET", `/v1/occurrences/${mine.ana}/swap-candidates`), 404, "not_found");
    expectError(await env.call("caio", "POST", "/v1/swaps", {
      body: JSON.stringify({ offeredOccurrenceID: mine.ana, requestedOccurrenceID: mine.bia }),
    }), 404, "not_found");
    expectError(await env.call("ana", "POST", "/v1/swaps", {
      body: JSON.stringify({ offeredOccurrenceID: mine.ana, requestedOccurrenceID: UNKNOWN }),
    }), 404, "not_found");
    for (const action of ["accept", "reject"]) {
      expectError(await env.call("caio", "POST", `/v1/swaps/${swapID}/${action}`), 404, "not_found");
      expectError(await env.call("bia", "POST", `/v1/swaps/${UNKNOWN}/${action}`), 404, "not_found");
    }
    expectError(await env.call("caio", "POST", `/v1/notifications/${UNKNOWN}/read`), 404, "not_found");
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: corpo inválido em POST /swaps: 400 bad_request`, async () => {
    const env = make();
    await twoHousesScenario(env);
    for (const body of ["lixo", "{}", JSON.stringify({ offeredOccurrenceID: "123", requestedOccurrenceID: UNKNOWN })]) {
      expectError(await env.call("ana", "POST", "/v1/swaps", { body }), 400, "bad_request");
    }
  });
}
