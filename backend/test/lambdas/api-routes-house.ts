import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEnvFactory } from "./api-support.ts";
import { bodyOf, createHouse, expectError, expectStatus, join, list, register, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

// Rotas de casa (BACKEND.md, seção 6.1): GET/DELETE /v1/me/house, POST /v1/houses, POST /v1/houses/join.

export function houseRoutes(name: string, make: ApiEnvFactory): void {
  test(`${name}: conta sem cadastro não usa nenhuma rota de casa`, async () => {
    const env = make();
    for (const [method, path] of [["GET", "/v1/me/house"], ["POST", "/v1/houses"], ["POST", "/v1/houses/join"], ["DELETE", "/v1/me/house"]] as const) {
      expectError(await env.call("ana", method, path, { body: "{}" }), 403, "account_not_registered");
    }
  });

  test(`${name}: sem casa: 404 no_house em /me/house, /me/tasks e na saída`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    expectError(await env.call("ana", "GET", "/v1/me/house"), 404, "no_house");
    expectError(await env.call("ana", "GET", "/v1/me/tasks"), 404, "no_house");
    expectError(await env.call("ana", "DELETE", "/v1/me/house"), 404, "no_house");
  });

  test(`${name}: criar casa devolve a casa, o fundador e a 'Casa toda'; GET /me/house devolve o mesmo`, async () => {
    const env = make();
    const ana = await register(env, "ana", "Ana");
    const response = await env.call("ana", "POST", "/v1/houses", { body: JSON.stringify({ name: "  Casa da Rua A ", timezone: "America/Recife" }) });
    const created = expectStatus(response, 201);
    const house = rec(created["house"]);
    assert.equal(house["name"], "Casa da Rua A");
    assert.equal(house["timezone"], "America/Recife");
    assert.match(text(house["accessCode"]), /^[A-Z0-9]{4,16}$/);
    assert.deepEqual(created["members"], [{ id: ana, name: "Ana" }]);
    const rooms = list(created["rooms"]).map(rec);
    assert.deepEqual(rooms.map((room) => [room["name"], room["kind"], room["visibility"], room["houseID"]]), [["Casa toda", "wholeHouse", "common", house["id"]]]);
    assert.deepEqual(bodyOf(await env.call("ana", "GET", "/v1/me/house")), created);
    assert.ok(!response.body.includes("email"));
  });

  test(`${name}: criar casa com dados inválidos não grava nada`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    const before = JSON.stringify(env.snapshot());
    const post = (body: string) => env.call("ana", "POST", "/v1/houses", { body });
    expectError(await post(JSON.stringify({ name: "", timezone: "America/Sao_Paulo" })), 400, "invalid_house_name");
    expectError(await post(JSON.stringify({ name: "x".repeat(81), timezone: "America/Sao_Paulo" })), 400, "invalid_house_name");
    expectError(await post(JSON.stringify({ name: "Casa", timezone: "Marte/Olympus" })), 400, "invalid_timezone");
    expectError(await post(JSON.stringify({ name: "Casa" })), 400, "bad_request");
    expectError(await post(JSON.stringify({ name: 7, timezone: "UTC" })), 400, "bad_request");
    expectError(await post("[]"), 400, "bad_request");
    expectError(await post("não é json"), 400, "bad_request");
    expectError(await post(JSON.stringify({ name: "Casa", timezone: "UTC", extra: "x".repeat(5000) })), 400, "bad_request");
    expectError(await env.call("ana", "POST", "/v1/houses"), 400, "bad_request");
    assert.equal(JSON.stringify(env.snapshot()), before);
    expectError(await env.call("ana", "GET", "/v1/me/house"), 404, "no_house");
  });

  test(`${name}: um morador, uma casa: criar ou entrar com casa existente é 409 already_in_house`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    await register(env, "caio", "Caio");
    const first = await createHouse(env, "ana");
    const other = await createHouse(env, "caio", "Outra");
    const body = JSON.stringify({ name: "Segunda", timezone: "UTC" });
    expectError(await env.call("ana", "POST", "/v1/houses", { body }), 409, "already_in_house");
    expectError(await env.call("ana", "POST", "/v1/houses/join", { body: JSON.stringify({ code: other.code }) }), 409, "already_in_house");
    // Repetir a entrada na própria casa também é recusado (sem Idempotency-Key na trilha).
    expectError(await env.call("ana", "POST", "/v1/houses/join", { body: JSON.stringify({ code: first.code }) }), 409, "already_in_house");
  });

  test(`${name}: entrar por código: sem caixa, devolve a casa com os dois moradores`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    await register(env, "bia", "Bia");
    const house = await createHouse(env, "ana");
    const joined = await join(env, "bia", `  ${house.code.toLowerCase()} `);
    assert.equal(rec(joined["house"])["id"], house.id);
    assert.deepEqual(list(joined["members"]).map((member) => rec(member)["name"]), ["Ana", "Bia"]);
    assert.deepEqual(bodyOf(await env.call("bia", "GET", "/v1/me/house")), joined);
    assert.deepEqual(bodyOf(await env.call("ana", "GET", "/v1/me/house")), joined);
  });

  test(`${name}: código inexistente ou malformado: 404 invalid_code uniforme; corpo sem código: 400`, async () => {
    const env = make();
    await register(env, "bia", "Bia");
    for (const code of ["ZZZZZZZZ", "x", "", "COM ESPACO", "ÇÇÇÇÇÇ", "A".repeat(40)]) {
      expectError(await env.call("bia", "POST", "/v1/houses/join", { body: JSON.stringify({ code }) }), 404, "invalid_code");
    }
    expectError(await env.call("bia", "POST", "/v1/houses/join", { body: "{}" }), 400, "bad_request");
    expectError(await env.call("bia", "POST", "/v1/houses/join", { body: JSON.stringify({ code: 12345678 }) }), 400, "bad_request");
    expectError(await env.call("bia", "GET", "/v1/me/house"), 404, "no_house");
  });

  test(`${name}: sair: 204, o morador fica sem casa e o código continua valendo`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    assert.equal((await env.call("bia", "DELETE", "/v1/me/house")).statusCode, 204);
    expectError(await env.call("bia", "GET", "/v1/me/house"), 404, "no_house");
    const remaining = bodyOf(await env.call("ana", "GET", "/v1/me/house"));
    assert.deepEqual(list(remaining["members"]).map((member) => rec(member)["name"]), ["Ana"]);
    // Pode voltar pelo mesmo código.
    assert.equal(rec((await join(env, "bia", house.code))["house"])["id"], house.id);
  });

  test(`${name}: o último morador só sai confirmando, e a casa é excluída (o código deixa de valer)`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    const house = await createHouse(env, "ana");
    expectError(await env.call("ana", "DELETE", "/v1/me/house"), 409, "house_deletion_confirmation_required");
    expectError(await env.call("ana", "DELETE", "/v1/me/house", { query: "confirmRoomDeletion=true" }), 409, "house_deletion_confirmation_required");
    expectError(await env.call("ana", "DELETE", "/v1/me/house", { query: "confirmHouseDeletion=sim" }), 400, "bad_request");
    assert.equal((await env.call("ana", "GET", "/v1/me/house")).statusCode, 200);
    assert.equal((await env.call("ana", "DELETE", "/v1/me/house", { query: "confirmHouseDeletion=true" })).statusCode, 204);
    expectError(await env.call("ana", "GET", "/v1/me/house"), 404, "no_house");
    await register(env, "bia", "Bia");
    expectError(await env.call("bia", "POST", "/v1/houses/join", { body: JSON.stringify({ code: house.code }) }), 404, "invalid_code");
    assert.notEqual((await createHouse(env, "ana")).id, house.id);
  });

  test(`${name}: sair sendo o último participante de um cômodo pede confirmação, repetível com a query`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const room = expectStatus(await env.call("ana", "POST", `/v1/houses/${house.id}/rooms`, {
      body: JSON.stringify({ name: "Ateliê", visibility: "privateRoom" }),
    }), 201);
    expectError(await env.call("ana", "DELETE", "/v1/me/house"), 409, "room_deletion_confirmation_required");
    expectError(await env.call("ana", "DELETE", "/v1/me/house", { query: "confirmRoomDeletion=talvez" }), 400, "bad_request");
    const before = bodyOf(await env.call("bia", "GET", "/v1/me/house"));
    assert.ok(list(before["rooms"]).map(rec).some((candidate) => candidate["id"] === rec(room)["id"]));
    assert.equal((await env.call("ana", "DELETE", "/v1/me/house", { query: "confirmRoomDeletion=true" })).statusCode, 204);
    const after = bodyOf(await env.call("bia", "GET", "/v1/me/house"));
    assert.ok(!list(after["rooms"]).map(rec).some((candidate) => candidate["id"] === rec(room)["id"]));
    assert.deepEqual(list(after["members"]).map((member) => rec(member)["name"]), ["Bia"]);
  });
}
