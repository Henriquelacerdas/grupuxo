import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import { InMemoryUserDirectory } from "../../src/adapters/in-memory/user-directory.ts";
import { InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore } from "../../src/adapters/in-memory/whatsapp.ts";
import { CognitoJwtVerifier } from "../../src/auth/cognito-jwt-verifier.ts";
import { parseCognitoSub } from "../../src/auth/token-verifier.ts";
import { maskPhone, createApiHandler } from "../../src/lambdas/api.ts";
import type { HttpApiResult } from "../../src/lambdas/events.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import {
  CLIENT_ID, FakeJwksSource, NOW, SUB, USER_POOL_ID, accessClaims, generateKey, idClaims, signJWT,
} from "../auth/support.ts";
import { sequentialIDs } from "../support/state-json.ts";
import { httpEvent } from "./support.ts";

const key = generateKey("kid-1");

function emptyState(): StoreState {
  return {
    users: [], houses: [], taskSwapRequests: [], notifications: [],
    rooms: [], houseMemberships: [], roomMemberships: [], definitions: [], occurrences: [], assignments: [], absences: [],
  };
}

function setup() {
  const jwks = new FakeJwksSource([key]);
  const verifier = new CognitoJwtVerifier({ userPoolID: USER_POOL_ID, clientID: CLIENT_ID }, { jwks, now: () => NOW });
  const users = new InMemoryUserDirectory(new InMemoryStore(emptyState()), sequentialIDs());
  const links = new InMemoryWhatsAppLinkStore();
  const linker = new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => NOW);
  const handler = createApiHandler({ verifier, users, linker, links });
  const call = (method: string, path: string, options: { token?: string | null; body?: string; headers?: Record<string, string> } = {}) =>
    handler(httpEvent({
      method, path,
      headers: { ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? signJWT({ key })}` }), ...options.headers },
      ...(options.body === undefined ? {} : { body: options.body }),
    }));
  return { jwks, users, links, linker, handler, call };
}

const parsed = (response: HttpApiResult): Record<string, unknown> => {
  const value: unknown = JSON.parse(response.body);
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
};

const sub = (() => {
  const result = parseCognitoSub(SUB);
  assert.ok(result !== null);
  return result;
})();

// --- autenticação ---

test("sem token válido: 401 com corpo fixo, igual para qualquer motivo", async () => {
  const { call } = setup();
  const expiredToken = signJWT({ key, claims: accessClaims({ exp: NOW / 1000 - 3600 }) });
  const otherKey = signJWT({ key: generateKey("kid-1") });
  const attempts = [
    call("POST", "/v1/me", { token: null, body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: "lixo", body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: expiredToken, body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: otherKey, body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: signJWT({ key, claims: idClaims() }), body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: null, headers: { authorization: "Basic abc" }, body: '{"name":"Ana"}' }),
    call("POST", "/v1/me", { token: null, headers: { authorization: "Bearer" }, body: '{"name":"Ana"}' }),
  ];
  for (const response of await Promise.all(attempts)) {
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parsed(response), { error: "unauthorized" });
  }
});

test("o ID token do Cognito é rejeitado", async () => {
  const { call, users } = setup();
  const response = await call("POST", "/v1/me", { token: signJWT({ key, claims: idClaims() }), body: '{"name":"Ana"}' });
  assert.equal(response.statusCode, 401);
  assert.equal(await users.userForSub(sub), null);
});

test("o esquema Bearer não distingue maiúsculas de minúsculas", async () => {
  const { call } = setup();
  const response = await call("POST", "/v1/me", { token: null, headers: { Authorization: `bEaReR ${signJWT({ key })}` }, body: '{"name":"Ana"}' });
  assert.equal(response.statusCode, 200);
});

test("chaves do Cognito indisponíveis: 503, não 401", async () => {
  const { call, jwks } = setup();
  jwks.failing = true;
  const response = await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(parsed(response), { error: "unavailable" });
});

test("erro inesperado: 500 sem detalhe", async () => {
  const handler = createApiHandler({
    verifier: { verify: async () => ({ cognitoSub: sub }) },
    users: { userForSub: async () => { throw new Error("senha do banco: hunter2"); }, ensureUser: async () => { throw new Error("hunter2"); } },
    linker: { issueInvitation: async () => { throw new Error("hunter2"); } },
    links: { linkForUser: async () => null, remove: async () => undefined },
  });
  const response = await handler(httpEvent({ method: "GET", path: "/v1/me/whatsapp", headers: { authorization: "Bearer x" } }));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(parsed(response), { error: "internal" });
  assert.ok(!response.body.includes("hunter2"));
});

// --- rotas ---

test("rota desconhecida: 404; método errado: 405 com a lista de métodos permitidos; ambos sem exigir token", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "/v1/outra", { token: null })).statusCode, 404);
  assert.equal((await call("GET", "/", { token: null })).statusCode, 404);
  assert.equal((await call("GET", "/v1/me/", { token: null })).statusCode, 404);
  assert.equal((await call("GET", "/v1/__proto__", { token: null })).statusCode, 404);
  assert.equal((await call("GET", "/v1/constructor", { token: null })).statusCode, 404);
  const wrong = await call("GET", "/v1/me", { token: null });
  assert.equal(wrong.statusCode, 405);
  assert.equal(wrong.headers?.["allow"], "POST");
  assert.equal((await call("PUT", "/v1/me/whatsapp", { token: null })).headers?.["allow"], "GET, DELETE");
  assert.equal((await call("GET", "/v1/me/whatsapp/link", { token: null })).statusCode, 405);
});

test("o método é aceito em qualquer caixa", async () => {
  const { call } = setup();
  assert.equal((await call("post", "/v1/me", { body: '{"name":"Ana"}' })).statusCode, 200);
});

test("evento que não é HTTP: 400", async () => {
  const { handler } = setup();
  assert.equal((await handler({ Records: [] })).statusCode, 400);
});

// --- POST /v1/me ---

test("POST /v1/me cria o morador e é idempotente", async () => {
  const { call, users } = setup();
  const first = await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers?.["content-type"], "application/json");
  const second = await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  assert.deepEqual(parsed(second), parsed(first));
  assert.equal(parsed(first)["id"], await users.userForSub(sub));
});

test("POST /v1/me não sobrescreve o nome de uma conta existente", async () => {
  const { call, users } = setup();
  const first = parsed(await call("POST", "/v1/me", { body: '{"name":"Ana"}' }));
  const second = parsed(await call("POST", "/v1/me", { body: '{"name":"Outra Pessoa"}' }));
  assert.equal(second["id"], first["id"]);
  assert.equal(await users.userForSub(sub), first["id"]);
});

test("POST /v1/me normaliza o nome com parseProfileName e recusa o que não serve", async () => {
  const { call, users } = setup();
  for (const body of ['{"name":""}', '{"name":"   "}', '{"name":"A\\nna"}', `{"name":"${"x".repeat(81)}"}`, "{}", '{"name":5}', "[]", '"Ana"', "não é json", ""]) {
    const response = await call("POST", "/v1/me", { body });
    assert.equal(response.statusCode, 400, body);
    assert.deepEqual(parsed(response), { error: "invalid_name" });
  }
  assert.equal(await users.userForSub(sub), null);
  assert.equal((await call("POST", "/v1/me", { body: '{"name":"  Ana  "}' })).statusCode, 200);
});

test("POST /v1/me recusa corpo acima de 4 KB e bytes que não são UTF-8", async () => {
  const { call, handler, users } = setup();
  const big = JSON.stringify({ name: "Ana", extra: "x".repeat(5000) });
  assert.equal((await call("POST", "/v1/me", { body: big })).statusCode, 400);
  const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x6e, 0x22, 0x3a, 0xff, 0x7d]);
  const response = await handler(httpEvent({
    method: "POST", path: "/v1/me", headers: { authorization: `Bearer ${signJWT({ key })}` }, body: invalidUtf8, base64: true,
  }));
  assert.equal(response.statusCode, 400);
  assert.equal(await users.userForSub(sub), null);
});

test("o corpo não escolhe o morador: campos como id e userID são ignorados", async () => {
  const { call, users } = setup();
  const response = await call("POST", "/v1/me", { body: '{"name":"Ana","id":"00000000-0000-4000-8000-000000000000","userID":"x"}' });
  assert.equal(parsed(response)["id"], await users.userForSub(sub));
  assert.notEqual(parsed(response)["id"], "00000000-0000-4000-8000-000000000000");
});

// --- vínculo do WhatsApp ---

test("rotas do WhatsApp exigem que a conta já tenha passado pelo POST /v1/me: 403", async () => {
  const { call } = setup();
  for (const [method, path] of [["POST", "/v1/me/whatsapp/link"], ["GET", "/v1/me/whatsapp"], ["DELETE", "/v1/me/whatsapp"]] as const) {
    const response = await call(method, path);
    assert.equal(response.statusCode, 403, `${method} ${path}`);
    assert.deepEqual(parsed(response), { error: "account_not_registered" });
  }
});

test("POST /v1/me/whatsapp/link devolve o link wa.me com o token e a validade em ISO", async () => {
  const { call } = setup();
  await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  const response = await call("POST", "/v1/me/whatsapp/link");
  assert.equal(response.statusCode, 200);
  const body = parsed(response);
  assert.match(String(body["url"]), /^https:\/\/wa\.me\/5511900000000\?text=Conectar%20meu%20WhatsApp%20ao%20Grupuxo\.%20C%C3%B3digo%3A%20[0-9a-f]{32}$/);
  assert.equal(body["expiresAt"], new Date(NOW + 15 * 60 * 1000).toISOString());
});

test("POST /v1/me/whatsapp/link com número já conectado: 409", async () => {
  const { call, users, links } = setup();
  await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  const id = await users.userForSub(sub);
  assert.ok(id !== null);
  await links.create({ userID: id, phoneE164: "+5511999998888", consentedAt: NOW, linkedAt: NOW });
  const response = await call("POST", "/v1/me/whatsapp/link");
  assert.equal(response.statusCode, 409);
  assert.deepEqual(parsed(response), { error: "already_linked" });
});

test("GET /v1/me/whatsapp: não conectado, depois conectado com o telefone mascarado", async () => {
  const { call, users, links } = setup();
  await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  assert.deepEqual(parsed(await call("GET", "/v1/me/whatsapp")), { linked: false });
  const id = await users.userForSub(sub);
  assert.ok(id !== null);
  await links.create({ userID: id, phoneE164: "+5511999998888", consentedAt: NOW, linkedAt: NOW });
  const response = await call("GET", "/v1/me/whatsapp");
  assert.deepEqual(parsed(response), { linked: true, phone: "+55•••••••8888", linkedAt: new Date(NOW).toISOString() });
  assert.ok(!response.body.includes("999998888"));
});

test("DELETE /v1/me/whatsapp remove o vínculo (204) e é idempotente", async () => {
  const { call, users, links } = setup();
  await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  const id = await users.userForSub(sub);
  assert.ok(id !== null);
  await links.create({ userID: id, phoneE164: "+5511999998888", consentedAt: NOW, linkedAt: NOW });
  const first = await call("DELETE", "/v1/me/whatsapp");
  assert.equal(first.statusCode, 204);
  assert.equal(first.body, "");
  assert.equal(await links.linkForUser(id), null);
  assert.equal((await call("DELETE", "/v1/me/whatsapp")).statusCode, 204);
});

test("cada conta só enxerga e mexe no próprio vínculo", async () => {
  const { call, users, links } = setup();
  await call("POST", "/v1/me", { body: '{"name":"Ana"}' });
  const ana = await users.userForSub(sub);
  assert.ok(ana !== null);
  await links.create({ userID: ana, phoneE164: "+5511999998888", consentedAt: NOW, linkedAt: NOW });

  const otherSub = "7c1d2e3f-0000-4000-8000-00000000abcd";
  const otherToken = signJWT({ key, claims: accessClaims({ sub: otherSub, username: otherSub }) });
  await call("POST", "/v1/me", { token: otherToken, body: '{"name":"Bia"}' });
  assert.deepEqual(parsed(await call("GET", "/v1/me/whatsapp", { token: otherToken })), { linked: false });
  await call("DELETE", "/v1/me/whatsapp", { token: otherToken });
  assert.notEqual(await links.linkForUser(ana), null, "o DELETE da Bia não toca no vínculo da Ana");
});

test("maskPhone mantém o código do país e os 4 últimos dígitos", () => {
  assert.equal(maskPhone("+5511999998888"), "+55•••••••8888");
  assert.equal(maskPhone("+14155552671"), "+14•••••2671");
});
