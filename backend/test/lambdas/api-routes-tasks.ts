import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnvFactory } from "./api-support.ts";
import {
  WEEKLY_TASK, bodyOf, createRoom, expectError, expectStatus, list, rec, text, twoHousesScenario,
} from "./api-routes-helpers.ts";

// Rotas de tarefa (BACKEND.md, seção 6.1): GET /v1/me/tasks, GET/POST /v1/rooms/{roomID}/tasks,
// GET/PATCH/DELETE /v1/rooms/{roomID}/tasks/{taskID} (editar e excluir só avulsa e só de quem criou) e POST …/end.

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

    // A primeira ocorrência é a da semana da criação: logo depois de criar, uma das duas já tem a tarefa.
    const mine = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map(rec);
    assert.equal((await mine("ana")).length + (await mine("bia")).length, 1);
    env.clock += 7 * 24 * 3_600_000;
    // Cada ocorrência pendente pertence a um dos dois moradores; juntos veem todas as suas.
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
    // A semana é de uma das duas: as duas participam desde a semana da entrada.
    let weekTotal = 0;
    for (const who of ["ana", "bia"] as const) {
      const all = list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]);
      const all2 = list(bodyOf(await env.call(who, "GET", "/v1/me/tasks", { query: "range=all" }))["tasks"]);
      const week = list(bodyOf(await env.call(who, "GET", "/v1/me/tasks", { query: "range=week" }))["tasks"]);
      assert.deepEqual(all, all2);
      assert.ok(week.length <= all.length);
      weekTotal += week.length;
    }
    assert.ok(weekTotal > 0);
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
    const put = await env.call("ana", "PUT", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}`);
    assert.deepEqual([put.statusCode, put.headers?.["allow"]], [405, "GET, PATCH, DELETE"]);
    const end = await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}/end`);
    assert.deepEqual([end.statusCode, end.headers?.["allow"]], [405, "POST"]);
    const mine = await env.call("ana", "POST", "/v1/me/tasks");
    assert.deepEqual([mine.statusCode, mine.headers?.["allow"]], [405, "GET"]);
  });

  const SPORADIC = {
    name: "Trocar lâmpada", details: "Da sala", effort: 1, kind: "sporadic", recurrence: { kind: "none" },
    assignmentPolicy: "selfAssigned",
  } as const;

  test(`${name}: avulsa guarda quem criou; PATCH edita nome, descrição e esforço e a ocorrência aberta herda o esforço`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(SPORADIC) }), 201);
    assert.equal(created["createdByUserID"], ids.ana);
    const path = `/v1/rooms/${roomID}/tasks/${text(created["id"])}`;
    const edited = expectStatus(
      await env.call("ana", "PATCH", path, { body: JSON.stringify({ name: "  Trocar a lâmpada ", effort: 3 }) }), 200,
    );
    assert.deepEqual(edited, { ...created, name: "Trocar a lâmpada", effort: 3 });
    // Só os campos enviados mudam.
    const described = expectStatus(await env.call("ana", "PATCH", path, { body: JSON.stringify({ details: "" }) }), 200);
    assert.deepEqual(described, { ...edited, details: "" });
    assert.deepEqual(bodyOf(await env.call("bia", "GET", path)), described);
    const [item] = list(bodyOf(await env.call("bia", "GET", "/v1/me/sporadic-tasks"))["tasks"]);
    assert.equal(rec(rec(item)["occurrence"])["effort"], 3);
  });

  test(`${name}: PATCH e DELETE de avulsa só de quem criou; DELETE de recorrente nunca (403); PATCH de recorrente vale para quem participa`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const sporadic = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(SPORADIC) }), 201);
    const recurring = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    const sporadicPath = `/v1/rooms/${roomID}/tasks/${text(sporadic["id"])}`;
    const recurringPath = `/v1/rooms/${roomID}/tasks/${text(recurring["id"])}`;
    const body = JSON.stringify({ name: "Outro nome" });
    expectError(await env.call("bia", "PATCH", sporadicPath, { body }), 403, "task_unavailable");
    expectError(await env.call("bia", "DELETE", sporadicPath), 403, "task_unavailable");
    expectError(await env.call("ana", "DELETE", recurringPath), 403, "task_unavailable");
    // Qualquer participante do cômodo edita a recorrente; quem é de outra casa nem a vê.
    assert.equal(expectStatus(await env.call("bia", "PATCH", recurringPath, { body }), 200)["name"], "Outro nome");
    expectError(await env.call("caio", "PATCH", recurringPath, { body }), 404, "not_found");
    assert.equal(bodyOf(await env.call("ana", "GET", sporadicPath))["name"], "Trocar lâmpada");
    assert.equal(bodyOf(await env.call("ana", "GET", recurringPath))["endedAt"], null);
  });

  test(`${name}: editar tarefa recorrente: nome, descrição, esforço e intervalo da repetição própria`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const linked = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify({ ...WEEKLY_TASK, followsRoom: true }) }), 201);
    const own = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, {
      body: JSON.stringify({ ...WEEKLY_TASK, name: "Própria", assignmentPolicy: "afterCompletion", followsRoom: false }),
    }), 201);
    const path = (task: Record<string, unknown>) => `/v1/rooms/${roomID}/tasks/${text(task["id"])}`;
    const patch = (task: Record<string, unknown>, body: unknown, who: "ana" | "bia" | "caio" = "bia") =>
      env.call(who, "PATCH", path(task), { body: JSON.stringify(body) });

    // Nome, descrição e esforço (qualquer participante): vale para a definição, e o aviso vai para os outros.
    const edited = expectStatus(await patch(linked, { name: "  Louça nova ", details: "Pia", effort: 3 }), 200);
    assert.deepEqual([edited["name"], edited["details"], edited["effort"], edited["followsRoom"]], ["Louça nova", "Pia", 3, true]);
    const kinds = list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec).map((n) => n["kind"]);
    assert.ok(kinds.includes("taskEdited") && kinds.includes("effortChanged"));

    // Repetição própria muda o intervalo (vale a partir da próxima janela); a da escala do cômodo não.
    const monthly = { kind: "recurring", frequency: "monthly", interval: 1 };
    assert.deepEqual(expectStatus(await patch(own, { recurrence: monthly }), 200)["recurrence"], monthly);
    expectError(await patch(linked, { recurrence: monthly }), 400, "invalid_schedule");
    expectError(await patch(own, { recurrence: { kind: "none" } }), 400, "invalid_schedule");
    expectError(await patch(own, { recurrence: { kind: "recurring", frequency: "daily", interval: 0 } }), 400, "invalid_schedule");
    expectError(await patch(own, { recurrence: "mensal" }), 400, "bad_request");
    // Repetir o que já é: idempotente.
    assert.equal((await patch(linked, { recurrence: edited["recurrence"] })).statusCode, 200);

    // Tarefa encerrada não se edita.
    assert.equal((await env.call("ana", "POST", `${path(own)}/end`)).statusCode, 204);
    expectError(await patch(own, { name: "Depois de encerrada" }), 403, "task_unavailable");
  });

  test(`${name}: PATCH com corpo inválido: 400; nome em branco: 400 invalid_task_name`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(SPORADIC) }), 201);
    const patch = (body: unknown) =>
      env.call("ana", "PATCH", `/v1/rooms/${roomID}/tasks/${text(created["id"])}`, { body: typeof body === "string" ? body : JSON.stringify(body) });
    for (const body of ["", "não é json", "[]", {}, { name: 3 }, { details: null }, { effort: 0 }, { effort: 4 }, { effort: 1.5 }]) {
      expectError(await patch(body), 400, "bad_request");
    }
    expectError(await patch({ name: "   " }), 400, "invalid_task_name");
    assert.equal(bodyOf(await env.call("ana", "GET", `/v1/rooms/${roomID}/tasks/${text(created["id"])}`))["name"], "Trocar lâmpada");
  });

  test(`${name}: DELETE de avulsa: 204, some da lista e da definição; repetir: 404`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(SPORADIC) }), 201);
    const path = `/v1/rooms/${roomID}/tasks/${text(created["id"])}`;
    assert.equal(list(bodyOf(await env.call("ana", "GET", "/v1/me/sporadic-tasks"))["tasks"]).length, 1);
    assert.equal((await env.call("ana", "DELETE", path)).statusCode, 204);
    assert.deepEqual(list(bodyOf(await env.call("ana", "GET", "/v1/me/sporadic-tasks"))["tasks"]), []);
    expectError(await env.call("ana", "GET", path), 404, "not_found");
    expectError(await env.call("ana", "DELETE", path), 404, "not_found");
    expectError(await env.call("ana", "PATCH", path, { body: JSON.stringify({ name: "x" }) }), 404, "not_found");
  });

  test(`${name}: PATCH e DELETE de quem não é da casa, de tarefa ou cômodo inexistente: 404`, async () => {
    const env = make();
    const { house, other } = await twoHousesScenario(env);
    const created = expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: JSON.stringify(SPORADIC) }), 201);
    const taskID = text(created["id"]);
    const body = JSON.stringify({ name: "x" });
    for (const [who, path] of [
      ["caio", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${taskID}`],
      ["ana", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${UNKNOWN}`],
      ["ana", `/v1/rooms/${other.wholeHouseRoomID}/tasks/${taskID}`],
      ["ana", `/v1/rooms/${UNKNOWN}/tasks/${taskID}`],
    ] as const) {
      expectError(await env.call(who, "PATCH", path, { body }), 404, "not_found");
      expectError(await env.call(who, "DELETE", path), 404, "not_found");
    }
    assert.equal(bodyOf(await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/tasks/${taskID}`))["name"], "Trocar lâmpada");
  });

  test(`${name}: editar, apagar avulsa e encerrar recorrente avisam os outros moradores (nunca quem fez)`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomPath = `/v1/rooms/${house.wholeHouseRoomID}/tasks`;
    const sporadic = expectStatus(await env.call("ana", "POST", roomPath, {
      body: JSON.stringify({ name: "Trocar lâmpada", details: "", effort: 1, kind: "sporadic", recurrence: { kind: "none" }, assignmentPolicy: "selfAssigned" }),
    }), 201);
    // Ignora o aviso de entrada na casa, que o cenário já gerou.
    const inbox = async (who: "ana" | "bia" | "caio") =>
      list(bodyOf(await env.call(who, "GET", "/v1/me/notifications"))["notifications"]).map(rec).filter((notice) => notice["kind"] !== "memberJoined");
    const kinds = async (who: "ana" | "bia" | "caio") => (await inbox(who)).map((notice) => notice["kind"]).sort();

    expectStatus(await env.call("ana", "PATCH", `${roomPath}/${text(sporadic["id"])}`, { body: JSON.stringify({ name: "Trocar a lâmpada", effort: 3 }) }), 200);
    assert.deepEqual(await kinds("bia"), ["effortChanged", "taskEdited"]);
    const [edited] = (await inbox("bia")).filter((notice) => notice["kind"] === "taskEdited");
    assert.ok(edited !== undefined);
    assert.deepEqual([edited["subjectName"], edited["taskDefinitionID"], edited["roomID"]], ["Trocar a lâmpada", sporadic["id"], house.wholeHouseRoomID]);
    assert.equal(edited["roomName"], "Casa toda", "a segunda linha traz o cômodo");
    const [effort] = (await inbox("bia")).filter((notice) => notice["kind"] === "effortChanged");
    assert.deepEqual([effort?.["effortFrom"], effort?.["effortTo"]], [1, 3], "e o esforço de antes e de depois");
    assert.deepEqual(await kinds("ana"), [], "quem editou não é avisado");
    assert.deepEqual(await kinds("caio"), [], "morador de outra casa não é avisado");

    assert.equal((await env.call("ana", "DELETE", `${roomPath}/${text(sporadic["id"])}`)).statusCode, 204);
    const afterDelete = await inbox("bia");
    assert.deepEqual(afterDelete.map((notice) => notice["kind"]), ["taskDeleted"], "avisos da tarefa apagada saem; fica só o de exclusão");
    assert.deepEqual([afterDelete[0]?.["subjectName"], afterDelete[0]?.["taskDefinitionID"]], ["Trocar a lâmpada", null]);
    assert.equal(afterDelete[0]?.["roomName"], "Casa toda");

    const recurring = expectStatus(await env.call("ana", "POST", roomPath, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    assert.equal((await env.call("ana", "POST", `${roomPath}/${text(recurring["id"])}/end`)).statusCode, 204);
    // Encerrar de novo é idempotente e não avisa outra vez.
    assert.equal((await env.call("ana", "POST", `${roomPath}/${text(recurring["id"])}/end`)).statusCode, 204);
    const ended = (await inbox("bia")).filter((notice) => notice["kind"] === "taskDeleted" && notice["taskDefinitionID"] === recurring["id"]);
    assert.equal(ended.length, 1);
    assert.equal(ended[0]?.["subjectName"], WEEKLY_TASK.name);
  });

  test(`${name}: 'Repetir com o cômodo' é um campo da tarefa: liga ao cômodo ou deixa a repetição própria`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, {
      name: "Cozinha", visibility: "common", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 },
    });
    const roomPath = `/v1/rooms/${text(room["id"])}/tasks`;
    const daily = { recurrence: { kind: "recurring", frequency: "daily", interval: 1 } };

    // Ligada: a recorrência vira a periodicidade do cômodo, qualquer que seja a enviada.
    const linked = expectStatus(await env.call("ana", "POST", roomPath, { body: JSON.stringify({ ...WEEKLY_TASK, ...daily, followsRoom: true }) }), 201);
    assert.equal(linked["followsRoom"], true);
    assert.deepEqual(linked["recurrence"], { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } });
    assert.deepEqual(bodyOf(await env.call("bia", "GET", `${roomPath}/${text(linked["id"])}`)), linked);

    // Desligada: mesmo com a periodicidade igual à do cômodo, é repetição própria (não entra na escala do cômodo).
    const own = expectStatus(await env.call("ana", "POST", roomPath, {
      body: JSON.stringify({ ...WEEKLY_TASK, name: "Própria", recurrence: { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } }, followsRoom: false }),
    }), 201);
    assert.equal(own["followsRoom"], false);

    // Sem o campo (app antigo): `null`, vale a periodicidade.
    const legacy = expectStatus(await env.call("ana", "POST", roomPath, { body: JSON.stringify({ ...WEEKLY_TASK, name: "Antiga" }) }), 201);
    assert.equal(legacy["followsRoom"], null);
    expectError(await env.call("ana", "POST", roomPath, { body: JSON.stringify({ ...WEEKLY_TASK, followsRoom: "sim" }) }), 400, "bad_request");
  });

  test(`${name}: repetição própria por conclusão: janela de 2 dias e a próxima só depois do intervalo`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const roomPath = `/v1/rooms/${house.wholeHouseRoomID}/tasks`;
    const own = { ...WEEKLY_TASK, assignmentPolicy: "afterCompletion", followsRoom: false } as const;
    const created = expectStatus(await env.call("ana", "POST", roomPath, { body: JSON.stringify(own) }), 201);
    assert.deepEqual(created["recurrence"], WEEKLY_TASK.recurrence, "o intervalo é mantido");
    const mine = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/tasks"))["tasks"]).map((item) => rec(rec(item)["occurrence"]));
    const [first] = [...(await mine("ana")), ...(await mine("bia"))];
    assert.ok(first !== undefined);
    assert.equal(typeof first["dueAt"], "string", "a janela tem prazo");
    // A janela acaba 2 dias de calendário depois do começo do dia em que abriu (até a meia-noite).
    const length = Date.parse(text(first["dueAt"])) - Date.parse(text(first["availableAt"]));
    assert.ok(length > 24 * 3_600_000 && length <= 48 * 3_600_000, `janela de ${length} ms`);
  });
  test(`${name}: editar recorrente: passar entre "Repetir com o cômodo" e repetição própria`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, {
      name: "Cozinha", visibility: "common", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 },
    });
    const roomPath = `/v1/rooms/${text(room["id"])}/tasks`;
    const monthly = { kind: "recurring", frequency: "monthly", interval: 1 };
    const created = expectStatus(await env.call("ana", "POST", roomPath, {
      body: JSON.stringify({ ...WEEKLY_TASK, name: "Panelas", followsRoom: true }),
    }), 201);
    const path = `${roomPath}/${text(created["id"])}`;
    const openOccurrences = async () => {
      const all = [
        ...list(bodyOf(await env.call("ana", "GET", "/v1/me/tasks"))["tasks"]),
        ...list(bodyOf(await env.call("bia", "GET", "/v1/me/tasks"))["tasks"]),
      ].map(rec).filter((item) => rec(item["definition"])["id"] === created["id"]);
      return all.map((item) => rec(item["occurrence"]));
    };
    assert.ok((await openOccurrences()).length > 0, "acompanhando o cômodo, já nasce com a vez da semana");

    // Para repetição própria sem intervalo válido: 400 e nada muda.
    expectError(await env.call("ana", "PATCH", path, { body: JSON.stringify({ followsRoom: false }) }), 400, "invalid_schedule");
    expectError(await env.call("ana", "PATCH", path, {
      body: JSON.stringify({ followsRoom: false, recurrence: { kind: "none" } }),
    }), 400, "invalid_schedule");
    assert.equal(rec(bodyOf(await env.call("ana", "GET", path)))["followsRoom"], true);
    expectError(await env.call("ana", "PATCH", path, { body: JSON.stringify({ followsRoom: "não" }) }), 400, "bad_request");

    // Do cômodo para repetição própria: uma janela de 2 dias, intervalo mensal, política por conclusão.
    const own = expectStatus(await env.call("ana", "PATCH", path, {
      body: JSON.stringify({ followsRoom: false, recurrence: monthly }),
    }), 200);
    assert.equal(own["followsRoom"], false);
    assert.equal(own["assignmentPolicy"], "afterCompletion");
    assert.deepEqual(own["recurrence"], monthly);
    const ownOpen = await openOccurrences();
    assert.equal(ownOpen.length, 1, "só a janela aberta da repetição própria");
    assert.equal(typeof ownOpen[0]?.["dueAt"], "string");

    // Já no modo pedido: nada muda (mudar o intervalo é edição simples).
    const same = expectStatus(await env.call("ana", "PATCH", path, { body: JSON.stringify({ followsRoom: false }) }), 200);
    assert.equal(same["followsRoom"], false);
    assert.equal((await openOccurrences()).length, 1);

    // De volta ao cômodo: a recorrência é a periodicidade do cômodo e a vez da própria some.
    const back = expectStatus(await env.call("bia", "PATCH", path, { body: JSON.stringify({ followsRoom: true }) }), 200);
    assert.equal(back["followsRoom"], true);
    assert.equal(back["assignmentPolicy"], "balancedAutomatically");
    assert.deepEqual(back["recurrence"], { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 } });
    assert.ok(!(await openOccurrences()).some((o) => o["id"] === ownOpen[0]?.["id"]), "a janela da repetição própria saiu");
    assert.ok((await openOccurrences()).length > 0);

    // Avulsa não passa por aqui; quem não é do cômodo é recusado.
    const sporadic = expectStatus(await env.call("ana", "POST", roomPath, {
      body: JSON.stringify({ name: "Avulsa", details: "", effort: 1, kind: "sporadic", recurrence: { kind: "none" }, assignmentPolicy: "selfAssigned" }),
    }), 201);
    expectError(await env.call("ana", "PATCH", `${roomPath}/${text(sporadic["id"])}`, {
      body: JSON.stringify({ followsRoom: false, recurrence: monthly }),
    }), 400, "invalid_schedule");
  });
}
