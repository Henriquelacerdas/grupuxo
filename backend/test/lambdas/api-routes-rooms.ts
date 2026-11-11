import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnvFactory } from "./api-support.ts";
import { WEEKLY_TASK, bodyOf, createRoom, expectError, expectStatus, list, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

// Rotas de cômodo (BACKEND.md, seção 6.1): POST /v1/houses/{houseID}/rooms, GET /v1/rooms/{roomID} e
// POST/DELETE /v1/rooms/{roomID}/members.

const UNKNOWN = "99999999-9999-4999-8999-999999999999";

export function roomRoutes(name: string, make: ApiEnvFactory): void {
  test(`${name}: criar cômodo comum: 201 com os padrões, visível para os dois moradores`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "  Cozinha ", visibility: "common", category: "kitchen", icon: "fork.knife", color: "orange" });
    assert.equal(room["name"], "Cozinha");
    assert.equal(room["houseID"], house.id);
    assert.equal(room["kind"], "standard");
    assert.equal(room["visibility"], "common");
    assert.equal(room["category"], "kitchen");
    assert.equal(room["color"], "orange");
    assert.deepEqual(room["periodicity"], { executionsPerPeriod: 1, intervalWeeks: 1 });
    assert.equal(room["responsibleCount"], 1);
    const participation = bodyOf(await env.call("bia", "GET", `/v1/rooms/${text(room["id"])}`));
    assert.equal(participation["isMember"], true);
    assert.equal(participation["memberCount"], 2);
    assert.deepEqual(rec(participation["room"])["id"], room["id"]);
    const mine = bodyOf(await env.call("bia", "GET", "/v1/me/house"));
    assert.ok(list(mine["rooms"]).map(rec).some((candidate) => candidate["id"] === room["id"]));
  });

  test(`${name}: cômodo privado: o criador entra sempre; quem não participa o vê sem participação`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const solo = await createRoom(env, "ana", house.id, { name: "Ateliê", visibility: "privateRoom" });
    const shared = await createRoom(env, "ana", house.id, { name: "Quarto", visibility: "privateRoom", participantIDs: [ids.bia] });
    const anaSolo = bodyOf(await env.call("ana", "GET", `/v1/rooms/${text(solo["id"])}`));
    assert.deepEqual([anaSolo["isMember"], anaSolo["memberCount"]], [true, 1]);
    const biaSolo = bodyOf(await env.call("bia", "GET", `/v1/rooms/${text(solo["id"])}`));
    assert.deepEqual([biaSolo["isMember"], biaSolo["memberCount"], biaSolo["responsibleNames"]], [false, 0, []]);
    // Quem não participa do cômodo também não vê a previsão do próximo ciclo.
    assert.deepEqual(biaSolo["nextResponsibleNames"], []);
    const biaShared = bodyOf(await env.call("bia", "GET", `/v1/rooms/${text(shared["id"])}`));
    assert.deepEqual([biaShared["isMember"], biaShared["memberCount"]], [true, 2]);
  });

  test(`${name}: criar cômodo inválido: erros do domínio e 400 para tipo errado; nada é gravado`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const before = JSON.stringify(env.snapshot());
    const post = (body: unknown, houseID = house.id) =>
      env.call("ana", "POST", `/v1/houses/${houseID}/rooms`, { body: typeof body === "string" ? body : JSON.stringify(body) });
    expectError(await post({ name: "  ", visibility: "common" }), 400, "invalid_room_name");
    expectError(await post({ name: "X", visibility: "privateRoom", participantIDs: [ids.caio] }), 400, "invalid_room_participants");
    expectError(await post({ name: "X", visibility: "privateRoom", participantIDs: ["não-é-uuid"] }), 400, "invalid_room_participants");
    expectError(await post({ name: "X", visibility: "common", periodicity: { executionsPerPeriod: 9, intervalWeeks: 1 } }), 400, "invalid_schedule");
    expectError(await post({ name: "X", visibility: "common", responsibleCount: 0 }), 400, "invalid_schedule");
    for (const bad of [
      { name: "X" }, { visibility: "common" }, { name: "X", visibility: "secreta" }, { name: 3, visibility: "common" },
      { name: "X", visibility: "common", category: "garagem" }, { name: "X", visibility: "common", color: "dourado" },
      { name: "X", visibility: "common", periodicity: { executionsPerPeriod: "1", intervalWeeks: 1 } },
      { name: "X", visibility: "common", responsibleCount: 1.5 }, { name: "X", visibility: "common", icon: 4 },
      { name: "X", visibility: "privateRoom", participantIDs: "todos" }, { name: "X", visibility: "privateRoom", participantIDs: [7] },
    ]) {
      expectError(await post(bad), 400, "bad_request");
    }
    expectError(await post("lixo"), 400, "bad_request");
    assert.equal(JSON.stringify(env.snapshot()), before);
  });

  test(`${name}: casa de outro morador, casa inexistente e ID malformado: 404 igual`, async () => {
    const env = make();
    const { house, other } = await twoHousesScenario(env);
    const body = JSON.stringify({ name: "X", visibility: "common" });
    expectError(await env.call("caio", "POST", `/v1/houses/${house.id}/rooms`, { body }), 404, "not_found");
    expectError(await env.call("ana", "POST", `/v1/houses/${other.id}/rooms`, { body }), 404, "not_found");
    expectError(await env.call("ana", "POST", `/v1/houses/${UNKNOWN}/rooms`, { body }), 404, "not_found");
    expectError(await env.call("ana", "POST", "/v1/houses/nao-e-uuid/rooms", { body }), 404, "not_found");
  });

  test(`${name}: participação do cômodo: de outra casa, inexistente ou malformado dá 404`, async () => {
    const env = make();
    const { house, other } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Sala", visibility: "common" });
    expectError(await env.call("caio", "GET", `/v1/rooms/${text(room["id"])}`), 404, "not_found");
    expectError(await env.call("ana", "GET", `/v1/rooms/${other.wholeHouseRoomID}`), 404, "not_found");
    expectError(await env.call("ana", "GET", `/v1/rooms/${UNKNOWN}`), 404, "not_found");
    expectError(await env.call("ana", "GET", "/v1/rooms/123"), 404, "not_found");
    const participation = bodyOf(await env.call("ana", "GET", `/v1/rooms/${text(room["id"])}`));
    assert.match(text(participation["periodStart"]), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  test(`${name}: membros do cômodo: entrar e sair (204), idempotentes, e só moradores da casa`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Escritório", visibility: "privateRoom" });
    const path = `/v1/rooms/${text(room["id"])}/members`;
    const members = async () => rec(bodyOf(await env.call("bia", "GET", `/v1/rooms/${text(room["id"])}`)))["isMember"];
    assert.equal(await members(), false);
    assert.equal((await env.call("ana", "POST", path, { body: JSON.stringify({ userID: ids.bia }) })).statusCode, 204);
    assert.equal(await members(), true);
    assert.equal((await env.call("ana", "POST", path, { body: JSON.stringify({ userID: ids.bia }) })).statusCode, 204);
    assert.equal((await env.call("ana", "DELETE", `${path}/${ids.bia}`)).statusCode, 204);
    assert.equal((await env.call("ana", "DELETE", `${path}/${ids.bia}`)).statusCode, 204);
    assert.equal(await members(), false);
    // Quem não é da casa não entra, e a rota não revela nada de outra casa.
    expectError(await env.call("ana", "POST", path, { body: JSON.stringify({ userID: ids.caio }) }), 404, "not_found");
    expectError(await env.call("ana", "POST", path, { body: JSON.stringify({ userID: UNKNOWN }) }), 404, "not_found");
    expectError(await env.call("caio", "POST", path, { body: JSON.stringify({ userID: ids.caio }) }), 404, "not_found");
    expectError(await env.call("caio", "DELETE", `${path}/${ids.ana}`), 404, "not_found");
    expectError(await env.call("ana", "POST", path, { body: JSON.stringify({ userID: "x" }) }), 400, "bad_request");
    expectError(await env.call("ana", "POST", path, { body: "{}" }), 400, "bad_request");
  });

  test(`${name}: 'Casa toda' não permite saída individual (409 whole_house_protected)`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    expectError(await env.call("ana", "DELETE", `/v1/rooms/${house.wholeHouseRoomID}/members/${ids.bia}`), 409, "whole_house_protected");
    expectError(await env.call("ana", "DELETE", `/v1/rooms/${house.wholeHouseRoomID}/members/${ids.bia}`, { query: "confirmDeletion=true" }), 409, "whole_house_protected");
  });

  test(`${name}: sair do cômodo sendo o último participante pede confirmação e exclui o cômodo`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Ateliê", visibility: "privateRoom" });
    const path = `/v1/rooms/${text(room["id"])}/members/${ids.ana}`;
    expectError(await env.call("ana", "DELETE", path), 409, "room_deletion_confirmation_required");
    expectError(await env.call("ana", "DELETE", path, { query: "confirmDeletion=sim" }), 400, "bad_request");
    assert.equal((await env.call("ana", "GET", `/v1/rooms/${text(room["id"])}`)).statusCode, 200);
    assert.equal((await env.call("ana", "DELETE", path, { query: "confirmDeletion=true" })).statusCode, 204);
    expectError(await env.call("ana", "GET", `/v1/rooms/${text(room["id"])}`), 404, "not_found");
    const mine = bodyOf(await env.call("ana", "GET", "/v1/me/house"));
    assert.ok(!list(mine["rooms"]).map(rec).some((candidate) => candidate["id"] === room["id"]));
  });

  test(`${name}: método errado nas rotas de cômodo: 405 com allow`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const rooms = await env.call("ana", "GET", `/v1/houses/${house.id}/rooms`);
    assert.deepEqual([rooms.statusCode, rooms.headers?.["allow"]], [405, "POST"]);
    const room = await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}`);
    assert.deepEqual([room.statusCode, room.headers?.["allow"]], [405, "GET, PATCH, DELETE"]);
    const requests = await env.call("ana", "PUT", `/v1/rooms/${house.wholeHouseRoomID}/access-requests`);
    assert.deepEqual([requests.statusCode, requests.headers?.["allow"]], [405, "GET, POST, DELETE"]);
    const members = await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/members`);
    assert.deepEqual([members.statusCode, members.headers?.["allow"]], [405, "POST"]);
    const member = await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/members/${UNKNOWN}`);
    assert.deepEqual([member.statusCode, member.headers?.["allow"]], [405, "DELETE"]);
    assert.equal(expectStatus(await env.call(null, "GET", `/v1/rooms/${house.wholeHouseRoomID}/members`), 405)["error"], "method_not_allowed");
  });

  test(`${name}: editar cômodo: nome, aparência e escala; 'Casa toda' e inválidos são recusados`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Cozinha", visibility: "common", category: "kitchen" });
    const path = `/v1/rooms/${text(room["id"])}`;
    const patch = (who: "ana" | "bia" | "caio", body: unknown) => env.call(who, "PATCH", path, { body: JSON.stringify(body) });

    const edited = expectStatus(await patch("bia", { name: "  Cozinha grande ", icon: "fork.knife", color: "orange", category: "kitchen" }), 200);
    assert.deepEqual([edited["name"], edited["icon"], edited["color"], edited["id"]], ["Cozinha grande", "fork.knife", "orange", room["id"]]);
    assert.equal(rec(bodyOf(await env.call("ana", "GET", path))["room"])["name"], "Cozinha grande");

    const rescheduled = expectStatus(await patch("ana", { periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 }, responsibleCount: 2 }), 200);
    assert.deepEqual([rescheduled["periodicity"], rescheduled["responsibleCount"]], [{ executionsPerPeriod: 1, intervalWeeks: 2 }, 2]);

    const before = JSON.stringify(env.snapshot());
    expectError(await patch("ana", { name: "   " }), 400, "invalid_room_name");
    expectError(await patch("ana", { periodicity: { executionsPerPeriod: 0, intervalWeeks: 1 } }), 400, "invalid_schedule");
    expectError(await patch("ana", { responsibleCount: 0 }), 400, "invalid_schedule");
    for (const body of [{}, { name: 7 }, { color: "roxo" }, { category: "x" }, { periodicity: "semanal" }, { responsibleCount: 1.5 }]) {
      expectError(await patch("ana", body), 400, "bad_request");
    }
    expectError(await env.call("ana", "PATCH", path, { body: "lixo" }), 400, "bad_request");
    expectError(await env.call("ana", "PATCH", `/v1/rooms/${house.wholeHouseRoomID}`, { body: JSON.stringify({ name: "Outra" }) }), 409, "whole_house_protected");
    expectError(await patch("caio", { name: "Invasão" }), 404, "not_found");
    expectError(await env.call("ana", "PATCH", `/v1/rooms/${UNKNOWN}`, { body: JSON.stringify({ name: "x" }) }), 404, "not_found");
    assert.equal(JSON.stringify(env.snapshot()), before);
    assert.ok(ids.ana.length > 0);
  });

  test(`${name}: editar a periodicidade faz as tarefas que acompanham o cômodo acompanharem`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Cozinha", visibility: "common" });
    const roomID = text(room["id"]);
    const linked = expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    expectStatus(await env.call("ana", "PATCH", `/v1/rooms/${roomID}`, { body: JSON.stringify({ periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } }) }), 200);
    const definition = bodyOf(await env.call("ana", "GET", `/v1/rooms/${roomID}/tasks/${text(linked["id"])}`));
    assert.deepEqual(definition["recurrence"], { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } });
    // A tarefa continua na lista do cômodo e do morador depois do replanejamento.
    assert.ok(list(bodyOf(await env.call("ana", "GET", `/v1/rooms/${roomID}/tasks`))["tasks"]).length > 0);
  });

  test(`${name}: excluir cômodo pede confirmação, apaga tudo dele e avisa quem acompanhava`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Cozinha", visibility: "common" });
    const roomID = text(room["id"]);
    expectStatus(await env.call("ana", "POST", `/v1/rooms/${roomID}/tasks`, { body: JSON.stringify(WEEKLY_TASK) }), 201);
    const path = `/v1/rooms/${roomID}`;
    expectError(await env.call("bia", "DELETE", path), 409, "room_deletion_confirmation_required");
    expectError(await env.call("bia", "DELETE", path, { query: "confirmDeletion=talvez" }), 400, "bad_request");
    assert.equal((await env.call("bia", "GET", path)).statusCode, 200);
    expectError(await env.call("caio", "DELETE", path, { query: "confirmDeletion=true" }), 404, "not_found");
    expectError(await env.call("ana", "DELETE", `/v1/rooms/${house.wholeHouseRoomID}`, { query: "confirmDeletion=true" }), 409, "whole_house_protected");

    assert.equal((await env.call("bia", "DELETE", path, { query: "confirmDeletion=true" })).statusCode, 204);
    expectError(await env.call("ana", "GET", path), 404, "not_found");
    expectError(await env.call("ana", "GET", `${path}/tasks`), 404, "not_found");
    const mine = bodyOf(await env.call("ana", "GET", "/v1/me/house"));
    assert.ok(!list(mine["rooms"]).map(rec).some((candidate) => candidate["id"] === roomID));
    expectError(await env.call("bia", "DELETE", path, { query: "confirmDeletion=true" }), 404, "not_found");

    const inbox = list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec).filter((n) => n["kind"] === "roomDeleted");
    assert.equal(inbox.length, 1);
    assert.deepEqual([inbox[0]?.["subjectName"], inbox[0]?.["actorUserID"], inbox[0]?.["roomID"]], ["Cozinha", ids.bia, null]);
    assert.ok(!list(bodyOf(await env.call("bia", "GET", "/v1/me/notifications"))["notifications"]).map(rec).some((n) => n["kind"] === "roomDeleted"));
  });

  test(`${name}: pedido de entrada em cômodo privado: pedir, listar, aprovar, recusar e cancelar`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const room = await createRoom(env, "ana", house.id, { name: "Ateliê", visibility: "privateRoom" });
    const roomID = text(room["id"]);
    const base = `/v1/rooms/${roomID}/access-requests`;
    const pending = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/room-access-requests"))["roomIDs"]);
    const requests = async () => list(bodyOf(await env.call("ana", "GET", base))["requests"]).map(rec);

    assert.deepEqual(await pending("bia"), []);
    assert.equal((await env.call("bia", "POST", base)).statusCode, 204);
    assert.equal((await env.call("bia", "POST", base)).statusCode, 204, "pedir de novo é idempotente");
    assert.deepEqual(await pending("bia"), [roomID]);
    assert.deepEqual((await requests()).map((r) => r["userID"]), [ids.bia]);
    const asked = list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec).filter((n) => n["kind"] === "roomAccessRequested");
    assert.equal(asked.length, 1, "um aviso só, mesmo pedindo duas vezes");
    assert.deepEqual([asked[0]?.["actorUserID"], asked[0]?.["roomID"], asked[0]?.["subjectName"]], [ids.bia, roomID, "Ateliê"]);

    // Quem não participa não vê os pedidos nem decide; participante comum de cômodo comum não pede.
    expectError(await env.call("bia", "GET", base), 404, "not_found");
    expectError(await env.call("bia", "POST", `${base}/${ids.bia}/approve`), 404, "not_found");
    expectError(await env.call("caio", "POST", base), 404, "not_found");
    expectError(await env.call("ana", "POST", base), 409, "room_access_not_requestable");
    expectError(await env.call("bia", "POST", `/v1/rooms/${house.wholeHouseRoomID}/access-requests`), 409, "room_access_not_requestable");

    // Cancelar apaga o pedido e o aviso; cancelar de novo não faz nada.
    assert.equal((await env.call("bia", "DELETE", base)).statusCode, 204);
    assert.equal((await env.call("bia", "DELETE", base)).statusCode, 204);
    assert.deepEqual(await pending("bia"), []);
    assert.deepEqual(await requests(), []);
    assert.ok(!list(bodyOf(await env.call("ana", "GET", "/v1/me/notifications"))["notifications"]).map(rec).some((n) => n["kind"] === "roomAccessRequested"));

    // Recusar: some o pedido, quem pediu é avisado e continua de fora.
    assert.equal((await env.call("bia", "POST", base)).statusCode, 204);
    assert.equal((await env.call("ana", "POST", `${base}/${ids.bia}/deny`)).statusCode, 204);
    expectError(await env.call("ana", "POST", `${base}/${ids.bia}/deny`), 404, "not_found");
    assert.equal(bodyOf(await env.call("bia", "GET", `/v1/rooms/${roomID}`))["isMember"], false);
    assert.ok(list(bodyOf(await env.call("bia", "GET", "/v1/me/notifications"))["notifications"]).map(rec).some((n) => n["kind"] === "roomAccessDenied"));

    // Aprovar: quem pediu entra no cômodo e é avisado.
    assert.equal((await env.call("bia", "POST", base)).statusCode, 204);
    assert.equal((await env.call("ana", "POST", `${base}/${ids.bia}/approve`)).statusCode, 204);
    assert.deepEqual(await pending("bia"), []);
    const joined = bodyOf(await env.call("bia", "GET", `/v1/rooms/${roomID}`));
    assert.deepEqual([joined["isMember"], joined["memberCount"]], [true, 2]);
    assert.ok(list(bodyOf(await env.call("bia", "GET", "/v1/me/notifications"))["notifications"]).map(rec).some((n) => n["kind"] === "roomAccessApproved"));
  });

  test(`${name}: o cômodo mostra quem assume no próximo ciclo (previsão do rodízio)`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = bodyOf(await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}`));
    const now = list(room["responsibleNames"]);
    const next = list(room["nextResponsibleNames"]);
    assert.equal(now.length, 1);
    assert.equal(next.length, 1);
    // Quem entrou no meio do ciclo só passa a valer no próximo, com a fila nova: a previsão é de um dos dois.
    assert.ok(["Ana", "Bia"].includes(String(next[0])));
  });

  test(`${name}: avaliar a semana: só quem não cuidou do cômodo avalia, na janela de 2 dias; o resultado sai para quem cuidou`, async () => {
    const env = make();
    const { house, ids } = await twoHousesScenario(env);
    const roomID = house.wholeHouseRoomID;
    const room = bodyOf(await env.call("ana", "GET", `/v1/rooms/${roomID}`));
    const [responsibleName] = list(room["responsibleNames"]);
    const [responsible, rater] = responsibleName === "Ana" ? (["ana", "bia"] as const) : (["bia", "ana"] as const);
    const periodStart = text(room["periodStart"]);
    const periodEnd = Date.parse(text(room["periodEnd"]));
    const pending = async (who: "ana" | "bia" | "caio") => list(bodyOf(await env.call(who, "GET", "/v1/me/ratings/pending"))["pending"]).map(rec);
    const summary = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/ratings/summary"))["summary"]).map(rec);
    const rate = (who: "ana" | "bia" | "caio", body: unknown) => env.call(who, "POST", `/v1/rooms/${roomID}/ratings`, { body: JSON.stringify(body) });

    // No primeiro ciclo ainda não há o que avaliar.
    assert.deepEqual(await pending(rater), []);
    env.clock = periodEnd + 12 * 3_600_000;
    assert.deepEqual(await pending(responsible), [], "quem cuidou do cômodo não o avalia");
    const [item] = await pending(rater);
    assert.ok(item !== undefined);
    assert.deepEqual([item["roomID"], item["roomName"], item["periodStart"]], [roomID, "Casa toda", periodStart]);
    assert.equal(Date.parse(text(item["windowEnd"])) - periodEnd, 2 * 24 * 3_600_000, "a janela dura 2 dias");
    assert.deepEqual(await pending("caio"), [], "outra casa não vê nada");

    // Entradas inválidas e acessos indevidos.
    const good = { periodStart, level: "great", tags: ["wellDone", "onTime"] };
    expectError(await rate(rater, { ...good, level: "otimo" }), 400, "bad_request");
    expectError(await rate(rater, { ...good, tags: ["inventada"] }), 400, "bad_request");
    expectError(await rate(rater, { ...good, periodStart: "ontem" }), 400, "bad_request");
    expectError(await rate(rater, { ...good, tags: "wellDone" }), 400, "bad_request");
    expectError(await rate(responsible, good), 403, "task_unavailable");
    expectError(await rate(rater, { ...good, periodStart: new Date(periodEnd).toISOString() }), 403, "task_unavailable");
    expectError(await rate("caio", good), 404, "not_found");

    // Avaliar: 204; refazer dentro da janela substitui; some da lista de pendentes.
    assert.equal((await rate(rater, { periodStart, level: "needsWork", tags: ["late"] })).statusCode, 204);
    assert.equal((await rate(rater, good)).statusCode, 204);
    assert.deepEqual(await pending(rater), []);
    // Com 1 avaliação e a janela aberta, o resultado ainda não sai; para quem não cuidou, nunca.
    assert.deepEqual(await summary(responsible), []);
    assert.deepEqual(await summary(rater), []);

    // Janela fechada: o resultado sai (nível e só as tags marcadas por 2 ou mais; aqui ninguém repetiu), sem quem avaliou.
    env.clock = periodEnd + 3 * 24 * 3_600_000;
    const [result] = await summary(responsible);
    assert.ok(result !== undefined);
    assert.deepEqual([result["roomID"], result["level"], result["tags"]], [roomID, "great", []]);
    assert.ok(!JSON.stringify(result).includes(ids[rater]), "o resultado nunca identifica quem avaliou");
    assert.deepEqual(await summary(rater), []);
    expectError(await rate(rater, good), 403, "task_unavailable");
  });
}
