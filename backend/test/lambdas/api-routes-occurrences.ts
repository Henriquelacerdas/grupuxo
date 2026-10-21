import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnv, ApiEnvFactory, Who } from "./api-support.ts";
import { WEEKLY_TASK, bodyOf, expectError, expectStatus, list, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

// Rotas de ocorrência (BACKEND.md, seção 6.1): POST /v1/occurrences/{occurrenceID}/complete e /reopen.

const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const WEEK = 7 * 24 * 3_600_000;

/** Uma tarefa semanal criada por Ana e a primeira ocorrência já disponível; devolve de quem ela é. */
async function pendingOccurrence(env: ApiEnv, wholeHouseRoomID: string): Promise<{ readonly id: string; readonly owner: Who }> {
  expectStatus(await env.call("ana", "POST", `/v1/rooms/${wholeHouseRoomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
  env.clock += WEEK;
  for (const who of ["ana", "bia"] as const) {
    const [first] = list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map(rec);
    if (first !== undefined) return { id: text(rec(first["occurrence"])["id"]), owner: who };
  }
  throw new Error("a tarefa criada deveria ter uma ocorrência disponível");
}

async function statusOf(env: ApiEnv, who: Who, id: string): Promise<unknown> {
  const mine = list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map(rec);
  return mine.map((item) => rec(item["occurrence"])).find((occurrence) => occurrence["id"] === id)?.["status"];
}

export function occurrenceRoutes(name: string, make: ApiEnvFactory): void {
  test(`${name}: concluir: 204, a ocorrência fica concluída e repetir não muda nada`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const { id, owner } = await pendingOccurrence(env, house.wholeHouseRoomID);
    assert.equal(await statusOf(env, owner, id), "assigned");
    assert.equal((await env.call(owner, "POST", `/v1/occurrences/${id}/complete`)).statusCode, 204);
    assert.equal(await statusOf(env, owner, id), "completed");
    const settled = JSON.stringify(env.snapshot());
    assert.equal((await env.call(owner, "POST", `/v1/occurrences/${id}/complete`)).statusCode, 204);
    assert.equal(JSON.stringify(env.snapshot()), settled);
    const done = list(bodyOf(await env.call(owner, "GET", "/v1/me/tasks"))["tasks"]).map(rec)
      .find((item) => rec(item["occurrence"])["id"] === id);
    assert.ok(done !== undefined);
    assert.equal(typeof rec(done["occurrence"])["completedAt"], "string");
  });

  test(`${name}: reabrir devolve a ocorrência a pendente`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const { id, owner } = await pendingOccurrence(env, house.wholeHouseRoomID);
    assert.equal((await env.call(owner, "POST", `/v1/occurrences/${id}/complete`)).statusCode, 204);
    assert.equal((await env.call(owner, "POST", `/v1/occurrences/${id}/reopen`)).statusCode, 204);
    assert.equal(await statusOf(env, owner, id), "assigned");
  });

  test(`${name}: ocorrência de outra casa, inexistente ou malformada: 404 igual, sem alterar nada`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const { id } = await pendingOccurrence(env, house.wholeHouseRoomID);
    const before = JSON.stringify(env.snapshot());
    for (const action of ["complete", "reopen"]) {
      expectError(await env.call("caio", "POST", `/v1/occurrences/${id}/${action}`), 404, "not_found");
      expectError(await env.call("ana", "POST", `/v1/occurrences/${UNKNOWN}/${action}`), 404, "not_found");
      expectError(await env.call("ana", "POST", `/v1/occurrences/${id.toUpperCase()}/${action}`), 404, "not_found");
      expectError(await env.call("ana", "POST", `/v1/occurrences/123/${action}`), 404, "not_found");
    }
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: quem não é o responsável não conclui a tarefa de outro (403 task_unavailable)`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const { id, owner } = await pendingOccurrence(env, house.wholeHouseRoomID);
    const other: Who = owner === "ana" ? "bia" : "ana";
    const before = JSON.stringify(env.snapshot());
    expectError(await env.call(other, "POST", `/v1/occurrences/${id}/complete`), 403, "task_unavailable");
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: método errado nas rotas de ocorrência: 405 com allow`, async () => {
    const env = make();
    const get = await env.call("ana", "GET", `/v1/occurrences/${UNKNOWN}/complete`);
    assert.deepEqual([get.statusCode, get.headers?.["allow"]], [405, "POST"]);
    const del = await env.call(null, "DELETE", `/v1/occurrences/${UNKNOWN}/reopen`);
    assert.deepEqual([del.statusCode, del.headers?.["allow"]], [405, "POST"]);
    expectError(await env.call(null, "POST", `/v1/occurrences/${UNKNOWN}/snooze`), 404, "not_found");
  });
}
