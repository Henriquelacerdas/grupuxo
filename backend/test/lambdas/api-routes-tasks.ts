import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnvFactory } from "./api-support.ts";
import {
  WEEKLY_TASK, bodyOf, createRoom, expectError, expectStatus, list, rec, text, twoHousesScenario,
} from "./api-routes-helpers.ts";

// Rotas de tarefa (BACKEND.md, seção 6.1): GET /v1/me/tasks, GET/POST /v1/rooms/{roomID}/tasks,
// GET /v1/rooms/{roomID}/tasks/{taskID} e POST …/end.

const UNKNOWN = "99999999-9999-4999-8999-999999999999";

export function taskRoutes(name: string, make: ApiEnvFactory): void {
  test(`${name}: criar tarefa: 201 com a definição; a lista do cômodo e a do morador a mostram`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, {
      body: JSON.stringify({ ...WEEKLY_TASK, name: "  Lavar a louça " }),
    }), 201);
    assert.equal(created["name"], "Lavar a louça");
    assert.equal(created["roomID"], house.wholeHouseRoomID);
    assert.equal(created["effort"], 2);
    assert.equal(created["kind"], "recurring");
    assert.deepEqual(created["recurrence"], WEEKLY_TASK.recurrence);
    assert.equal(created["endedAt"], null);

    const inRoom = list(bodyOf(await env.call("bia", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks`))["tasks"]).map(rec);
    assert.ok(inRoom.length > 0);
    assert.ok(inRoom.every((item) => rec(item["definition"])["id"] === created["id"]));
    const dueDates = inRoom.map((item) => rec(item["occurrence"])["dueAt"]).filter((due) => typeof due === "string").map(String);
    assert.deepEqual(dueDates, [...dueDates].sort());

    // A primeira ocorrência começa na segunda seguinte à criação: antes disso, ninguém tem tarefa.
    assert.deepEqual(bodyOf(await env.call("ana", "GET", "/v1/me/tasks")), { tasks: [] });
    env.clock += 7 * 24 * 3_600_000;
    // Cada ocorrência pendente pertence a um dos dois moradores; juntos veem todas as suas.
    const mine = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map(rec);
    const anaTasks = await mine("ana");
    const biaTasks = await mine("bia");
    for (const item of [...anaTasks, ...biaTasks]) assert.equal(rec(item["definition"])["id"], created["id"]);
    assert.ok(anaTasks.every((item) => rec(item["assignee"])["id"] === ids.ana));
    assert.ok(biaTasks.every((item) => rec(item["assignee"])["id"] === ids.bia));
    assert.ok(anaTasks.length + biaTasks.length > 0);
    assert.ok(!JSON.stringify(inRoom).includes("rotationQueue"));
  });

  test(`${name}: minhas tarefas: range=week só traz a semana corrente; range inválido é 400`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    env.clock += 7 * 24 * 3_600_000;
    const all = list(bodyOf(await env.call("ana", "GET", "/v1/me/tasks"))["tasks"]);
    const all2 = list(bodyOf(await env.call("ana", "GET", "/v1/me/tasks", { query: "range=all" }))["tasks"]);
    const week = list(bodyOf(await env.call("ana", "GET", "/v1/me/tasks", { query: "range=week" }))["tasks"]);
    assert.deepEqual(all, all2);
    assert.ok(week.length > 0 && week.length <= all.length);
    expectError(await env.call("ana", "GET", "/v1/me/tasks", { query: "range=mes" }), 400, "bad_request");
  });

  test(`${name}: ler a definição: igual à criada, visível ao outro morador; encerrar mantém o histórico e é idempotente`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    const path = `/v1/rooms/${house.wholeHouseRoomID}/tasks/${text(created["id"])}`;
    assert.deepEqual(bodyOf(await env.call("bia", "GET", path)), created);

    assert.equal((await env.call("ana", "POST", `${path}/end`)).statusCode, 204);
    const ended = bodyOf(await env.call("bia", "GET", path));
    assert.equal(typeof ended["endedAt"], "string");
    assert.deepEqual({ ...ended, endedAt: null }, created);
    assert.equal((await env.call("ana", "POST", `${path}/end`)).statusCode, 204);
    assert.equal(bodyOf(await env.call("ana", "GET", path))["endedAt"], ended["endedAt"]);
  });

  test(`${name}: criar tarefa inválida: erros do domínio e 400 para tipo errado; nada é gravado`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const before = JSON.stringify(env.snapshot());
    const post = (body: unknown) =>
      env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: typeof body === "string" ? body : JSON.stringify(body) });
    expectError(await post({ ...WEEKLY_TASK, name: "   " }), 400, "invalid_task_name");
    expectError(await post({ ...WEEKLY_TASK, kind: "sporadic" }), 400, "invalid_schedule");
    expectError(await post({ ...WEEKLY_TASK, assignmentPolicy: "selfAssigned" }), 400, "invalid_schedule");
    expectError(await post({ ...WEEKLY_TASK, recurrence: { kind: "none" } }), 400, "invalid_schedule");
    expectError(await post({ ...WEEKLY_TASK, recurrence: { kind: "recurring", frequency: "weekly", interval: 0 } }), 400, "invalid_schedule");
    for (const bad of [
      { ...WEEKLY_TASK, effort: 0 }, { ...WEEKLY_TASK, effort: 4 }, { ...WEEKLY_TASK, effort: 2.5 }, { ...WEEKLY_TASK, effort: "2" },
      { ...WEEKLY_TASK, kind: "diaria" }, { ...WEEKLY_TASK, assignmentPolicy: "sorteio" },
      { ...WEEKLY_TASK, recurrence: { kind: "monthly" } }, { ...WEEKLY_TASK, recurrence: "weekly" },
      { ...WEEKLY_TASK, recurrence: { kind: "weekly", periodicity: { executionsPerPeriod: 1 } } },
      { ...WEEKLY_TASK, recurrence: { kind: "recurring", frequency: "hourly", interval: 1 } },
      { name: "Sem os outros campos" }, { ...WEEKLY_TASK, details: undefined }, { ...WEEKLY_TASK, name: 9 },
    ]) {
      expectError(await post(bad), 400, "bad_request");
    }
    expectError(await post("lixo"), 400, "bad_request");
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: tarefa avulsa (sporadic, selfAssigned, sem repetição) é aceita`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, {
      body: JSON.stringify({ name: "Trocar lâmpada", details: "", effort: 1, kind: "sporadic", recurrence: { kind: "none" }, assignmentPolicy: "selfAssigned" }),
    }), 201);
    assert.equal(created["kind"], "sporadic");
    // As avulsas não entram na lista de recorrentes do cômodo, mas a definição é lida.
    const items = list(bodyOf(await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks`))["tasks"]);
    assert.deepEqual(items, []);
    assert.deepEqual(bodyOf(await env.call("bia", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${text(created["id"])}`)), created);
  });

  test(`${name}: cômodo de outra casa, inexistente ou malformado: 404 em todas as rotas de tarefa`, async () => {
    const env = make();
    const { house, other } = await twoHousesScenario(env);
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    const taskPath = `/v1/rooms/${house.wholeHouseRoomID}/tasks/${text(created["id"])}`;
    const body = JSON.stringify(WEEKLY_TASK);
    for (const [who, method, path, options] of [
      ["caio", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, {}],
      ["caio", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body }],
      ["caio", "GET", taskPath, {}],
      ["caio", "POST", `${taskPath}/end`, {}],
      ["ana", "GET", `/v1/rooms/${other.wholeHouseRoomID}/tasks`, {}],
      ["ana", "POST", `/v1/rooms/${other.wholeHouseRoomID}/tasks`, { body }],
      ["ana", "GET", `/v1/rooms/${UNKNOWN}/tasks`, {}],
      ["ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}`, {}],
      ["ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}/end`, {}],
      ["ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/nao-e-uuid`, {}],
      ["ana", "GET", `/v1/rooms/${other.wholeHouseRoomID}/tasks/${text(created["id"])}`, {}],
    ] as const) {
      expectError(await env.call(who, method, path, options), 404, "not_found");
    }
    // A tarefa não foi encerrada pelas tentativas acima.
    assert.equal(bodyOf(await env.call("ana", "GET", taskPath))["endedAt"], null);
  });

  test(`${name}: cômodo privado: quem não participa recebe 403 ao criar e 404 ao ler ou encerrar`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Ateliê", visibility: "privateRoom" });
    const roomID = text(room["id"]);
    expectError(await env.call("bia", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 403, "task_unavailable");
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    const taskPath = `/v1/rooms/${roomID}/tasks/${text(created["id"])}`;
    expectError(await env.call("bia", "GET", taskPath), 404, "not_found");
    expectError(await env.call("bia", "POST", `${taskPath}/end`), 404, "not_found");
    assert.deepEqual(list(bodyOf(await env.call("bia", "GET", `/v1/rooms/${roomID}/tasks`))["tasks"]), []);
    assert.equal(bodyOf(await env.call("ana", "GET", taskPath))["endedAt"], null);
  });

  test(`${name}: método errado nas rotas de tarefa: 405 com allow`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const tasks = await env.call("ana", "PUT", `/v1/rooms/${house.wholeHouseRoomID}/tasks`);
    assert.deepEqual([tasks.statusCode, tasks.headers?.["allow"]], [405, "GET, POST"]);
    // Sem PATCH na trilha (BACKEND.md §6.1): a edição é escondida no app.
    const patch = await env.call("ana", "PATCH", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}`);
    assert.deepEqual([patch.statusCode, patch.headers?.["allow"]], [405, "GET"]);
    const end = await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}/end`);
    assert.deepEqual([end.statusCode, end.headers?.["allow"]], [405, "POST"]);
    const mine = await env.call("ana", "POST", "/v1/me/tasks");
    assert.deepEqual([mine.statusCode, mine.headers?.["allow"]], [405, "GET"]);
  });
}
