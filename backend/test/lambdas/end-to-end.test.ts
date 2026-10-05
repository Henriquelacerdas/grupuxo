import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryRateCounter } from "../../src/adapters/in-memory/rate-counter.ts";
import { InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryMessageQueue, InMemoryWhatsAppLinkStore } from "../../src/adapters/in-memory/whatsapp.ts";
import { GetMyTasksUseCase, GetRoomTasksUseCase, GetSporadicTasksUseCase } from "../../src/domain/use-cases/tasks.ts";
import { composeCognitoVerifier, composeWhatsAppWorker, type WorkerCompositionDependencies } from "../../src/lambdas/compose.ts";
import { parseApiSettings, parseWorkerSecrets, parseWorkerSettings } from "../../src/lambdas/config.ts";
import { createWorkerHandler } from "../../src/lambdas/worker.ts";
import { createWebhookHandler } from "../../src/lambdas/webhook.ts";
import type { HttpFetch, HttpRequestInit } from "../../src/http.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import { WebhookHandler } from "../../src/whatsapp/webhook/webhook-handler.ts";
import { WhatsAppWorker } from "../../src/whatsapp/worker.ts";
import { CLIENT_ID, NOW, USER_POOL_ID, generateKey, signJWT } from "../auth/support.ts";
import { World } from "../support/world.ts";
import { APP_SECRET, VERIFY_TOKEN, sign, textEvent } from "../whatsapp/support.ts";
import { httpEvent, sqsEvent } from "./support.ts";

const PHONE = "+5511999998888";
const GEMINI_KEY = "AIzaSy-chave-gemini";
const WHATSAPP_TOKEN = "EAAJB-token-whatsapp";
const GRAPH = "https://graph.facebook.com/";
const GEMINI = "https://generativelanguage.googleapis.com/";

interface Call {
  readonly url: string;
  readonly init: HttpRequestInit;
}

/** Dependências reais do worker sobre adaptadores em memória; só o HTTP de saída é falso. */
function workerDeps(http: HttpFetch, rateLimit = "2"): { world: World; links: InMemoryWhatsAppLinkStore; deps: WorkerCompositionDependencies } {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const links = new InMemoryWhatsAppLinkStore();
  const now = () => world.now;
  const deps: WorkerCompositionDependencies = {
    settings: parseWorkerSettings({ GEMINI_MODEL: "gemini-2.5-flash-lite", WHATSAPP_GRAPH_VERSION: "v25.0", RATE_LIMIT_MAX_MESSAGES: rateLimit, RATE_LIMIT_WINDOW_SECONDS: "60" }),
    secrets: parseWorkerSecrets(JSON.stringify({ WHATSAPP_TOKEN, PHONE_NUMBER_ID: "106540352242922", GEMINI_API_KEY: GEMINI_KEY })),
    http, now, links,
    inbox: new InMemoryInboxStore(),
    linker: new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, now),
    rateCounter: new InMemoryRateCounter(),
    assistant: {
      houses: env.houses, rooms: env.rooms,
      myTasks: new GetMyTasksUseCase(env.tasks, env.houses, now),
      roomTasks: new GetRoomTasksUseCase(env.tasks),
      sporadicTasks: new GetSporadicTasksUseCase(env.tasks),
    },
  };
  return { world, links, deps };
}

function setup(geminiBody: string) {
  const calls: Call[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => (url.startsWith(GEMINI) ? geminiBody : "{}") };
  };
  const { world, links, deps } = workerDeps(http);
  const queue = new InMemoryMessageQueue();
  const webhook = createWebhookHandler(new WebhookHandler({ verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET }, queue, deps.now));
  const worker = createWorkerHandler(composeWhatsAppWorker(deps));
  const graphCalls = () => calls.filter((c) => c.url.startsWith(GRAPH));
  const geminiCalls = () => calls.filter((c) => c.url.startsWith(GEMINI));

  /** Entrega uma mensagem do morador: webhook assinado → fila → worker. */
  async function deliver(wamid: string, text: string): Promise<void> {
    const body = textEvent({ wamid, body: text });
    const response = await webhook(httpEvent({ method: "POST", headers: { "x-hub-signature-256": sign(body) }, body, base64: true }));
    assert.equal(response.statusCode, 200);
    const messages = queue.drain();
    const result = await worker(sqsEvent(...messages.map((m) => ({ messageId: m.wamid, group: m.phoneE164, body: JSON.stringify(m) }))));
    assert.deepEqual(result, { batchItemFailures: [] });
  }
  return { world, links, deliver, graphCalls, geminiCalls };
}

const functionCall = (name: string, args: Record<string, unknown>): string =>
  JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });

function sentText(call: Call | undefined): string {
  assert.ok(call !== undefined && call.init.body !== undefined);
  const body: unknown = JSON.parse(call.init.body);
  assert.ok(typeof body === "object" && body !== null && "text" in body && typeof body.text === "object" && body.text !== null && "body" in body.text);
  return String(body.text.body);
}

test("webhook assinado → fila → worker → Gemini → Graph: o morador recebe as tarefas dele", async () => {
  const { world, links, deliver, graphCalls, geminiCalls } = setup(functionCall("list_my_tasks", { range: "week" }));
  await links.create({ userID: world.seed.users.marina.id, phoneE164: PHONE, consentedAt: 1, linkedAt: 1 });
  await deliver("wamid.1", "quais são minhas tarefas da semana?");

  assert.equal(geminiCalls().length, 1);
  assert.equal(geminiCalls()[0]?.init.headers?.["x-goog-api-key"], GEMINI_KEY);
  const [graph] = graphCalls();
  assert.equal(graph?.url, "https://graph.facebook.com/v25.0/106540352242922/messages");
  assert.equal(graph?.init.headers?.["authorization"], `Bearer ${WHATSAPP_TOKEN}`);
  assert.ok(sentText(graph).startsWith("Suas tarefas da semana:"), sentText(graph));
  assert.equal(JSON.parse(graph?.init.body ?? "{}").to, PHONE);
});

test("número sem vínculo: orientação fixa, sem chamar o Gemini", async () => {
  const { deliver, graphCalls, geminiCalls } = setup(functionCall("list_my_tasks", {}));
  await deliver("wamid.1", "oi");
  assert.equal(geminiCalls().length, 0);
  assert.equal(sentText(graphCalls()[0]), WhatsAppWorker.unlinkedReply);
});

test("a mesma mensagem entregue duas vezes é respondida uma só", async () => {
  const { world, links, deliver, graphCalls } = setup(functionCall("list_my_tasks", { range: "week" }));
  await links.create({ userID: world.seed.users.marina.id, phoneE164: PHONE, consentedAt: 1, linkedAt: 1 });
  await deliver("wamid.1", "minhas tarefas");
  await deliver("wamid.1", "minhas tarefas");
  assert.equal(graphCalls().length, 1);
});

test("limite de taxa: duas respondidas, uma avisada, o resto em silêncio e sem custo de Gemini", async () => {
  const { world, links, deliver, graphCalls, geminiCalls } = setup(functionCall("list_my_tasks", { range: "week" }));
  await links.create({ userID: world.seed.users.marina.id, phoneE164: PHONE, consentedAt: 1, linkedAt: 1 });
  for (const wamid of ["w1", "w2", "w3", "w4", "w5"]) await deliver(wamid, "minhas tarefas");
  assert.equal(geminiCalls().length, 2);
  assert.equal(graphCalls().length, 3);
  assert.equal(sentText(graphCalls()[2]), WhatsAppWorker.rateLimitedReply);
});

test("falha da Graph API: a mensagem volta em batchItemFailures para o SQS tentar de novo", async () => {
  const http: HttpFetch = async (url) => {
    const failing = url.startsWith(GRAPH);
    return { ok: !failing, status: failing ? 500 : 200, text: async () => "{}" };
  };
  const { deps } = workerDeps(http, "5");
  const worker = createWorkerHandler(composeWhatsAppWorker(deps));
  const body = JSON.stringify({ wamid: "wamid.X", phoneE164: PHONE, text: "oi", receivedAt: 1 });
  const result = await worker(sqsEvent({ messageId: "m1", group: PHONE, body }));
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m1" }] });
});

test("a composição falha fechada: sem modelo, sem versão ou com segredo inválido o worker não é criado", () => {
  const { deps } = workerDeps(async () => ({ ok: true, status: 200, text: async () => "{}" }));
  assert.doesNotThrow(() => composeWhatsAppWorker(deps));
  assert.throws(() => composeWhatsAppWorker({ ...deps, settings: { ...deps.settings, geminiModel: "../x" } }), /GEMINI_MODEL/);
  assert.throws(() => composeWhatsAppWorker({ ...deps, settings: { ...deps.settings, graphVersion: "latest" } }), /WHATSAPP_GRAPH_VERSION/);
  assert.throws(() => composeWhatsAppWorker({ ...deps, secrets: { ...deps.secrets, phoneNumberID: "12/3" } }), /PHONE_NUMBER_ID/);
  assert.throws(() => composeWhatsAppWorker({ ...deps, settings: { ...deps.settings, rateLimit: { limit: 0, windowSeconds: 60 } } }), /limite/);
});

test("composeCognitoVerifier busca o JWKS do pool configurado e valida um access token", async () => {
  const settings = parseApiSettings({ COGNITO_USER_POOL_ID: USER_POOL_ID, COGNITO_CLIENT_ID: CLIENT_ID, BOT_PHONE_NUMBER: "5511900000000" });
  const key = generateKey("kid-e2e");
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: key.kid, use: "sig", alg: "RS256" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ keys: [jwk] }) };
  };
  const verifier = composeCognitoVerifier(settings, http, () => NOW);
  const verified = await verifier.verify(signJWT({ key }));
  assert.equal(verified.cognitoSub, "5b9c1e0a-3f4d-4a8e-9a77-0c2d6f1b8e11");
  assert.deepEqual(urls, [`https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`]);
});
