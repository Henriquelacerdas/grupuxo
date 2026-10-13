import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCognitoSub, AuthenticationError, type TokenVerifier } from "../../src/auth/token-verifier.ts";
import { LambdaConfigError } from "../../src/lambdas/config.ts";
import type { HttpFetch, HttpRequestInit } from "../../src/http.ts";
import { createHttpServer } from "../../src/main/http-server.ts";
import { composeLocalApp, type LocalApp } from "../../src/main/local-app.ts";
import { sequentialAccessCodes, sequentialIDs } from "../support/state-json.ts";
import { APP_SECRET, VERIFY_TOKEN, payload, sign } from "../whatsapp/support.ts";

const NOW = Date.UTC(2026, 9, 14, 12);
const PHONE = "5511999998888";

function envFor(dbPath: string): Record<string, string> {
  return {
    DB_PATH: dbPath, GEMINI_MODEL: "gemini-teste", WHATSAPP_GRAPH_VERSION: "v25.0", RATE_LIMIT_MAX_MESSAGES: "50",
    RATE_LIMIT_WINDOW_SECONDS: "60", BOT_PHONE_NUMBER: "5511900000000", COGNITO_USER_POOL_ID: "us-east-1_Abc123",
    COGNITO_CLIENT_ID: "client123", VERIFY_TOKEN, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_TOKEN: "token-whatsapp",
    PHONE_NUMBER_ID: "106540352242922", GEMINI_API_KEY: "chave-gemini",
  };
}

/** Token "t-<conta>" vale como o access token da conta `<conta>`; qualquer outro é recusado. */
const verifier: TokenVerifier = {
  async verify(token) {
    const sub = token.startsWith("t-") ? parseCognitoSub(token.slice(2)) : null;
    if (sub === null) throw new AuthenticationError("malformed");
    return { cognitoSub: sub };
  },
};

interface Running {
  readonly app: LocalApp;
  readonly base: string;
  readonly sent: { url: string; body: string }[];
  readonly dropped: () => number;
  stop(): Promise<void>;
}

async function start(dbPath: string, overrides: Record<string, string> = {}): Promise<Running> {
  const sent: { url: string; body: string }[] = [];
  let dropped = 0;
  const http: HttpFetch = async (url, init: HttpRequestInit) => {
    sent.push({ url, body: init.body ?? "" });
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const newID = sequentialIDs();
  const app = composeLocalApp({
    env: { ...envFor(dbPath), ...overrides }, http, now: () => NOW, newID, newAccessCode: sequentialAccessCodes(),
    onDropped: () => { dropped += 1; }, verifier, retryDelayMs: 0,
  });
  const server = createHttpServer(app.handlers);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    app, base: `http://127.0.0.1:${port}`, sent, dropped: () => dropped,
    stop: async () => {
      await app.queue.idle();
      app.database.flush();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function call(running: Running, method: string, path: string, options: { token?: string; json?: unknown; headers?: Record<string, string>; body?: Uint8Array } = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token !== undefined) headers["authorization"] = `Bearer ${options.token}`;
  if (options.json !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${running.base}${path}`, {
    method, headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : options.body !== undefined ? { body: options.body } : {}),
  });
  const text = await response.text();
  return { status: response.status, text, json: (): unknown => JSON.parse(text) };
}

function whatsAppText(wamid: string, text: string): Uint8Array {
  return payload({ messages: `[{"from":"${PHONE}","id":"${wamid}","timestamp":"1700000000","type":"text","text":{"body":${JSON.stringify(text)}}}]` });
}

async function deliver(running: Running, wamid: string, text: string): Promise<void> {
  const body = whatsAppText(wamid, text);
  const response = await call(running, "POST", "/webhook", { body, headers: { "x-hub-signature-256": sign(body) } });
  assert.equal(response.status, 200);
  await running.app.queue.idle();
}

test("saúde, rota desconhecida e verificação do webhook", async () => {
  const running = await start(join(mkdtempSync(join(tmpdir(), "grupuxo-srv-")), "db.json"));
  try {
    assert.equal((await call(running, "GET", "/health")).status, 200);
    assert.equal((await call(running, "GET", "/nada")).status, 404);
    const challenge = await call(running, "GET", `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`);
    assert.deepEqual([challenge.status, challenge.text], [200, "abc123"]);
    assert.equal((await call(running, "GET", "/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x")).status, 403);
    assert.equal((await call(running, "POST", "/webhook", { body: whatsAppText("w", "oi"), headers: { "x-hub-signature-256": "sha256=00" } })).status, 401);
    assert.equal((await call(running, "GET", "/v1/me/house")).status, 401);
  } finally {
    await running.stop();
  }
});

test("fluxo completo: conta, casa, vínculo pelo WhatsApp e tudo continua depois de reiniciar", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "grupuxo-srv-")), "data", "db.json");
  const first = await start(dbPath);
  let linkText: string;
  try {
    assert.equal((await call(first, "POST", "/v1/me", { token: "t-ana", json: { name: "Ana" } })).status, 200);
    const created = await call(first, "POST", "/v1/houses", { token: "t-ana", json: { name: "Casa da Ana", timezone: "America/Sao_Paulo" } });
    assert.equal(created.status, 201);
    const link = await call(first, "POST", "/v1/me/whatsapp/link", { token: "t-ana" });
    assert.equal(link.status, 200);
    const url = (link.json() as { url: string }).url;
    linkText = new URL(url).searchParams.get("text") ?? "";
    assert.ok(linkText.includes("Código:"));

    await deliver(first, "wamid.1", linkText);
    assert.equal(first.sent.length, 1);
    assert.ok(first.sent[0]?.url.includes("graph.facebook.com/v25.0/106540352242922/messages"));
    assert.ok(first.sent[0]?.body.includes("conectado"), "o bot confirmou o vínculo");
    assert.equal(first.dropped(), 0);
    assert.equal(((await call(first, "GET", "/v1/me/whatsapp", { token: "t-ana" })).json() as { linked: boolean }).linked, true);
  } finally {
    await first.stop();
  }

  const second = await start(dbPath);
  try {
    const house = await call(second, "GET", "/v1/me/house", { token: "t-ana" });
    assert.equal(house.status, 200);
    assert.ok(house.text.includes("Casa da Ana"));
    assert.equal(((await call(second, "GET", "/v1/me/whatsapp", { token: "t-ana" })).json() as { linked: boolean }).linked, true);
    // O token já foi usado e a mensagem já foi processada: reentrega do mesmo wamid não responde de novo.
    await deliver(second, "wamid.1", linkText);
    assert.equal(second.sent.length, 0);
    // A conta continua a mesma: não é preciso registrar de novo.
    assert.equal((await call(second, "POST", "/v1/me", { token: "t-ana", json: { name: "Ana" } })).status, 200);
  } finally {
    await second.stop();
  }
});

test("número sem vínculo recebe o aviso fixo, sem chamar o Gemini", async () => {
  const running = await start(join(mkdtempSync(join(tmpdir(), "grupuxo-srv-")), "db.json"));
  try {
    await deliver(running, "wamid.2", "quais são minhas tarefas?");
    assert.equal(running.sent.length, 1);
    assert.ok(running.sent[0]?.url.includes("graph.facebook.com"));
    assert.ok(running.sent[0]?.body.includes("Não encontrei seu número"));
  } finally {
    await running.stop();
  }
});

test("configuração faltando falha com o nome da variável, sem valor", () => {
  const { GEMINI_API_KEY: _omitted, ...incomplete } = envFor("x");
  assert.throws(
    () => composeLocalApp({ env: incomplete, http: async () => ({ ok: true, status: 200, text: async () => "" }), now: () => NOW, newID: sequentialIDs(), newAccessCode: sequentialAccessCodes(), onDropped: () => {} }),
    (error: unknown) => error instanceof LambdaConfigError && error.variable === "GEMINI_API_KEY",
  );
});
