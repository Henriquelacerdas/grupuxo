import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBS, type ApiEnvFactory } from "./api-support.ts";
import { WEEKLY_TASK, bodyOf, createHouse, expectError, expectStatus, join, list, register, rec, text, twoHousesScenario } from "./api-routes-helpers.ts";

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
    assert.deepEqual(created["members"], [{ id: ana, name: "Ana", photoURL: null }]);
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

  test(`${name}: excluir conta: sai da casa, a conta some e uma nova conta com o mesmo token recomeça do zero`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    expectError(await env.call(null, "DELETE", "/v1/me"), 401, "unauthorized");
    assert.deepEqual(env.identities.removed, [], "sem token nada é apagado");
    assert.equal((await env.call("bia", "DELETE", "/v1/me")).statusCode, 204);
    assert.deepEqual(env.identities.removed, [SUBS.bia], "o usuário do Cognito é o da Bia, e só ele");
    expectError(await env.call("bia", "GET", "/v1/me"), 403, "account_not_registered");
    expectError(await env.call("bia", "GET", "/v1/me/house"), 403, "account_not_registered");
    const remaining = bodyOf(await env.call("ana", "GET", "/v1/me/house"));
    assert.deepEqual(list(remaining["members"]).map((member) => rec(member)["name"]), ["Ana"]);
    await register(env, "bia", "Bia");
    expectError(await env.call("bia", "GET", "/v1/me/house"), 404, "no_house");
    assert.equal(rec((await join(env, "bia", house.code))["house"])["id"], house.id);
  });

  test(`${name}: excluir conta apaga o usuário do Cognito pelo username do token (login com a Apple)`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    assert.equal((await env.call("ana", "DELETE", "/v1/me", { username: "signinwithapple_001234.abcdef.5678" })).statusCode, 204);
    assert.deepEqual(env.identities.removed, ["signinwithapple_001234.abcdef.5678"]);
  });

  test(`${name}: excluir conta sem nunca ter cadastrado conta ainda apaga o usuário do Cognito`, async () => {
    const env = make();
    assert.equal((await env.call("caio", "DELETE", "/v1/me")).statusCode, 204);
    assert.deepEqual(env.identities.removed, [SUBS.caio]);
    // Repetir é seguro.
    assert.equal((await env.call("caio", "DELETE", "/v1/me")).statusCode, 204);
    expectError(await env.call("caio", "GET", "/v1/me"), 403, "account_not_registered");
  });

  test(`${name}: falha ao apagar o usuário do Cognito: 500 sem detalhe, e repetir termina o serviço`, async () => {
    const env = make();
    await twoHousesScenario(env);
    env.identities.failWith = new Error("AccessDenied hunter2");
    const failed = await env.call("bia", "DELETE", "/v1/me");
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(JSON.parse(failed.body), { error: "internal" });
    // Os dados do servidor já saíram; o usuário do Cognito continua e a repetição o apaga.
    expectError(await env.call("bia", "GET", "/v1/me"), 403, "account_not_registered");
    env.identities.failWith = null;
    assert.equal((await env.call("bia", "DELETE", "/v1/me")).statusCode, 204);
    assert.deepEqual(env.identities.removed, [SUBS.bia]);
  });

  test(`${name}: excluir conta do último morador apaga a casa; sem casa também funciona`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    const house = await createHouse(env, "ana");
    assert.equal((await env.call("ana", "DELETE", "/v1/me")).statusCode, 204);
    expectError(await env.call("ana", "GET", "/v1/me"), 403, "account_not_registered");
    await register(env, "bia", "Bia");
    expectError(await env.call("bia", "POST", "/v1/houses/join", { body: JSON.stringify({ code: house.code }) }), 404, "invalid_code");
    assert.equal((await env.call("bia", "DELETE", "/v1/me")).statusCode, 204);
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

  test(`${name}: PATCH /me muda o nome do morador; nome inválido: 400 invalid_name e nada muda`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const renamed = expectStatus(await env.call("bia", "PATCH", "/v1/me", { body: JSON.stringify({ name: "  Bia Souza " }) }), 200);
    assert.equal(renamed["name"], "Bia Souza");
    const after = bodyOf(await env.call("ana", "GET", "/v1/me/house"));
    assert.deepEqual(list(after["members"]).map((member) => rec(member)["name"]), ["Ana", "Bia Souza"]);
    const before = JSON.stringify(env.snapshot());
    for (const body of [JSON.stringify({ name: "" }), JSON.stringify({ name: "x".repeat(81) }), JSON.stringify({ name: "A\nna" }), JSON.stringify({ name: 7 }), "{}", "[]", "lixo"]) {
      expectError(await env.call("bia", "PATCH", "/v1/me", { body }), 400, "invalid_name");
    }
    assert.equal(JSON.stringify(env.snapshot()), before);
    expectError(await env.call(null, "PATCH", "/v1/me", { body: JSON.stringify({ name: "Caio" }) }), 401, "unauthorized");
    assert.equal(house.id.length > 0, true);
  });

  test(`${name}: PATCH /me sem cadastro: 403 account_not_registered`, async () => {
    const env = make();
    expectError(await env.call("caio", "PATCH", "/v1/me", { body: JSON.stringify({ name: "Caio" }) }), 403, "account_not_registered");
  });

  test(`${name}: PATCH /houses/{id} renomeia a casa para qualquer morador; de fora é 404`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    await register(env, "caio", "Caio");
    const renamed = expectStatus(await env.call("bia", "PATCH", `/v1/houses/${house.id}`, { body: JSON.stringify({ name: "  Casa Nova " }) }), 200);
    assert.equal(rec(renamed["house"])["name"], "Casa Nova");
    assert.equal(rec(renamed["house"])["accessCode"], house.code, "o código de convite não muda");
    assert.deepEqual(bodyOf(await env.call("ana", "GET", "/v1/me/house")), renamed);
    // De novo com o mesmo nome: idempotente.
    expectStatus(await env.call("bia", "PATCH", `/v1/houses/${house.id}`, { body: JSON.stringify({ name: "Casa Nova" }) }), 200);
    const before = JSON.stringify(env.snapshot());
    expectError(await env.call("caio", "PATCH", `/v1/houses/${house.id}`, { body: JSON.stringify({ name: "Invasão" }) }), 404, "not_found");
    for (const body of [JSON.stringify({ name: "" }), JSON.stringify({ name: "x".repeat(81) })]) {
      expectError(await env.call("ana", "PATCH", `/v1/houses/${house.id}`, { body }), 400, "invalid_house_name");
    }
    for (const body of [JSON.stringify({ name: 7 }), "{}", "lixo"]) {
      expectError(await env.call("ana", "PATCH", `/v1/houses/${house.id}`, { body }), 400, "bad_request");
    }
    assert.equal(JSON.stringify(env.snapshot()), before);
    assert.equal(rec(bodyOf(await env.call("ana", "GET", "/v1/me/house"))["house"])["name"], "Casa Nova");
  });

  test(`${name}: entrar e sair da casa avisam os outros moradores; quem saiu perde os avisos da casa`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    await register(env, "bia", "Bia");
    const house = await createHouse(env, "ana");
    const inbox = async (who: "ana" | "bia") => list(bodyOf(await env.call(who, "GET", "/v1/me/notifications"))["notifications"]).map(rec);
    assert.deepEqual(await inbox("ana"), [], "o fundador não é avisado da própria criação");
    const bia = await join(env, "bia", house.code);
    const [joined] = await inbox("ana");
    assert.ok(joined !== undefined);
    assert.deepEqual(
      [joined["kind"], joined["subjectName"], joined["swapRequestID"], joined["taskDefinitionID"], joined["roomID"]],
      ["memberJoined", "Bia", null, null, null],
    );
    assert.equal(joined["actorUserID"], list(bia["members"]).map(rec).find((member) => member["name"] === "Bia")?.["id"]);
    assert.deepEqual(await inbox("bia"), [], "quem entrou não é avisado da própria entrada");

    assert.equal((await env.call("bia", "DELETE", "/v1/me/house")).statusCode, 204);
    assert.deepEqual((await inbox("ana")).map((notice) => [notice["kind"], notice["subjectName"]]).sort(), [["memberJoined", "Bia"], ["memberLeft", "Bia"]]);
  });

  test(`${name}: modo férias: liga a partir da próxima segunda, replaneja a escala e desliga (idempotente)`, async () => {
    const env = make();
    const { house } = await twoHousesScenario(env);
    const call = (who: "ana" | "bia" | "caio", method: string) => env.call(who, method, "/v1/me/vacation");
    // Uma tarefa semanal dá turnos aos dois, para a escala ter o que replanejar.
    expectStatus(await env.call("ana", "POST", `/v1/rooms/${house.wholeHouseRoomID}/tasks`, { body: JSON.stringify({ ...WEEKLY_TASK, followsRoom: true }) }), 201);

    assert.deepEqual(expectStatus(await call("bia", "GET"), 200), { onVacation: false, startsAt: null });
    const on = expectStatus(await call("bia", "PUT"), 200);
    assert.equal(on["onVacation"], true);
    const startsAt = Date.parse(text(on["startsAt"]));
    assert.ok(startsAt > env.clock, "vale a partir do próximo ciclo, não agora");
    assert.ok(startsAt - env.clock <= 7 * 24 * 3_600_000, "a próxima segunda fica a no máximo 7 dias");
    assert.deepEqual(expectStatus(await call("bia", "PUT"), 200), on, "ligar de novo não muda nada");
    assert.deepEqual(expectStatus(await call("bia", "GET"), 200), on);
    assert.deepEqual(expectStatus(await call("ana", "GET"), 200), { onVacation: false, startsAt: null }, "só vale para quem ligou");
    assert.deepEqual(expectStatus(await call("caio", "GET"), 200), { onVacation: false, startsAt: null });

    // As tarefas continuam consultáveis para os dois depois do replanejamento.
    expectStatus(await env.call("bia", "GET", "/v1/me/tasks"), 200);
    expectStatus(await env.call("ana", "GET", "/v1/me/tasks"), 200);

    env.clock = startsAt + 3 * 24 * 3_600_000; // já começou
    assert.deepEqual(expectStatus(await call("bia", "DELETE"), 200), { onVacation: false, startsAt: null });
    assert.deepEqual(expectStatus(await call("bia", "DELETE"), 200), { onVacation: false, startsAt: null }, "desligar de novo não muda nada");
    assert.deepEqual(expectStatus(await call("bia", "GET"), 200), { onVacation: false, startsAt: null });

    // Desligar antes de começar apaga a ausência por inteiro.
    expectStatus(await call("bia", "PUT"), 200);
    assert.deepEqual(expectStatus(await call("bia", "DELETE"), 200), { onVacation: false, startsAt: null });
  });

  test(`${name}: modo férias sem casa: 404 no_house`, async () => {
    const env = make();
    await register(env, "ana", "Ana");
    for (const method of ["GET", "PUT", "DELETE"]) expectError(await env.call("ana", method, "/v1/me/vacation"), 404, "no_house");
    expectError(await env.call("caio", "PUT", "/v1/me/vacation"), 403, "account_not_registered");
  });

  test(`${name}: foto do perfil: pedir envio, confirmar, aparecer nos moradores e apagar`, async () => {
    const env = make();
    const { ids } = await twoHousesScenario(env);
    const members = async () => list(bodyOf(await env.call("ana", "GET", "/v1/me/house"))["members"]).map(rec);
    const photoOf = async (id: string) => (await members()).find((m) => m["id"] === id)?.["photoURL"];

    const target = expectStatus(await env.call("bia", "POST", "/v1/me/photo"), 200);
    assert.equal(target["key"], `photos/${ids.bia}`, "uma chave só por morador: enviar de novo sobrescreve");
    assert.deepEqual(target["headers"], { "Content-Type": "image/jpeg" });
    assert.equal(typeof target["uploadURL"], "string");
    assert.equal(await photoOf(ids.bia), null, "sem confirmar, não há foto");

    expectError(await env.call("bia", "PUT", "/v1/me/photo", { body: JSON.stringify({ key: `photos/${ids.ana}` }) }), 400, "bad_request");
    expectError(await env.call("bia", "PUT", "/v1/me/photo", { body: "{}" }), 400, "bad_request");
    const confirmed = expectStatus(await env.call("bia", "PUT", "/v1/me/photo", { body: JSON.stringify({ key: text(target["key"]) }) }), 200);
    assert.match(text(confirmed["photoURL"]), /^memory:\/\/view\/photos\//);
    assert.equal(await photoOf(ids.bia), confirmed["photoURL"], "os outros moradores veem a foto");
    assert.equal(await photoOf(ids.ana), null);

    assert.equal((await env.call("bia", "DELETE", "/v1/me/photo")).statusCode, 204);
    assert.equal(await photoOf(ids.bia), null);
    assert.deepEqual(env.photos.removed, [`photos/${ids.bia}`]);
  });

  test(`${name}: push: registrar e tirar aparelho, e ler e gravar as preferências`, async () => {
    const env = make();
    const { ids } = await twoHousesScenario(env);
    const token = "ab".repeat(32);
    const put = (body: unknown) => env.call("bia", "PUT", "/v1/me/devices", { body: JSON.stringify(body) });

    assert.equal((await put({ token, environment: "sandbox" })).statusCode, 204);
    assert.equal((await put({ token, environment: "production" })).statusCode, 204, "registrar de novo troca o ambiente");
    assert.deepEqual(await env.push.devices(ids.bia as never), [{ token, environment: "production" }]);
    for (const body of [{}, { token: "xyz", environment: "sandbox" }, { token, environment: "dev" }, { token: 7, environment: "sandbox" }]) {
      expectError(await put(body), 400, "bad_request");
    }
    expectError(await env.call("bia", "DELETE", "/v1/me/devices"), 400, "bad_request");
    assert.equal((await env.call("bia", "DELETE", "/v1/me/devices", { query: `token=${token}` })).statusCode, 204);
    assert.deepEqual(await env.push.devices(ids.bia as never), []);

    const defaults = expectStatus(await env.call("bia", "GET", "/v1/me/notification-preferences"), 200);
    assert.deepEqual(defaults, { remindTasks: true, reminderHour: 9, cycleTurned: true, houseActivity: true, weeklySummary: true });
    const changed = { remindTasks: false, reminderHour: 18, cycleTurned: true, houseActivity: false, weeklySummary: true };
    assert.deepEqual(expectStatus(await env.call("bia", "PUT", "/v1/me/notification-preferences", { body: JSON.stringify(changed) }), 200), changed);
    assert.deepEqual(expectStatus(await env.call("bia", "GET", "/v1/me/notification-preferences"), 200), changed);
    assert.deepEqual(expectStatus(await env.call("ana", "GET", "/v1/me/notification-preferences"), 200), defaults, "por morador");
    for (const body of [{ ...changed, reminderHour: 24 }, { ...changed, reminderHour: 1.5 }, { ...changed, houseActivity: "sim" }, {}]) {
      expectError(await env.call("bia", "PUT", "/v1/me/notification-preferences", { body: JSON.stringify(body) }), 400, "bad_request");
    }
  });
}
