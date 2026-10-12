import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnvFactory } from "./api-support.ts";
import { bodyOf, createRoom, expectError, expectStatus, list, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

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
    const room = await env.call("ana", "DELETE", `/v1/rooms/${house.wholeHouseRoomID}`);
    assert.deepEqual([room.statusCode, room.headers?.["allow"]], [405, "GET"]);
    const members = await env.call("ana", "GET", `/v1/rooms/${house.wholeHouseRoomID}/members`);
    assert.deepEqual([members.statusCode, members.headers?.["allow"]], [405, "POST"]);
    const member = await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/members/${UNKNOWN}`);
    assert.deepEqual([member.statusCode, member.headers?.["allow"]], [405, "DELETE"]);
    assert.equal(expectStatus(await env.call(null, "GET", `/v1/rooms/${house.wholeHouseRoomID}/members`), 405)["error"], "method_not_allowed");
  });
}
