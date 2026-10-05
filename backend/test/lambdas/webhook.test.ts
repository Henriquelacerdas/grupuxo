import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMessageQueue } from "../../src/adapters/in-memory/whatsapp.ts";
import { createWebhookHandler } from "../../src/lambdas/webhook.ts";
import { WebhookHandler } from "../../src/whatsapp/webhook/webhook-handler.ts";
import { APP_SECRET, VERIFY_TOKEN, sign, textEvent } from "../whatsapp/support.ts";
import { httpEvent } from "./support.ts";

const NOW = 1_700_000_000_000;

function setup() {
  const queue = new InMemoryMessageQueue();
  const handler = createWebhookHandler(new WebhookHandler({ verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET }, queue, () => NOW));
  return { queue, handler };
}

const query = (token: string, challenge = "1158201444") =>
  `hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`;

test("verificação (GET): devolve o challenge como texto puro", async () => {
  const { handler } = setup();
  const response = await handler(httpEvent({ method: "GET", rawQueryString: query(VERIFY_TOKEN) }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "1158201444");
  assert.equal(response.headers?.["content-type"], "text/plain; charset=utf-8");
});

test("verificação (GET) com token errado: 403", async () => {
  const { handler } = setup();
  assert.equal((await handler(httpEvent({ rawQueryString: query("outro") }))).statusCode, 403);
});

test("evento assinado com corpo em texto: enfileira a mensagem", async () => {
  const { handler, queue } = setup();
  const body = textEvent({ body: "quais são minhas tarefas?" });
  const response = await handler(httpEvent({ method: "POST", headers: { "X-Hub-Signature-256": sign(body) }, body }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(queue.drain().map((m) => [m.wamid, m.phoneE164, m.text]), [["wamid.A", "+5511999998888", "quais são minhas tarefas?"]]);
});

test("a assinatura vale sobre os bytes brutos: o mesmo corpo em base64 também passa", async () => {
  const { handler, queue } = setup();
  const body = textEvent({ body: "açaí é bom, ótimo!" });
  const response = await handler(httpEvent({ method: "POST", headers: { "x-hub-signature-256": sign(body) }, body, base64: true }));
  assert.equal(response.statusCode, 200);
  assert.equal(queue.drain().length, 1);
});

test("assinatura inválida: 401 e nada na fila (texto e base64)", async () => {
  const { handler, queue } = setup();
  const body = textEvent();
  for (const base64 of [false, true]) {
    const response = await handler(httpEvent({ method: "POST", headers: { "x-hub-signature-256": sign(body, "outro-segredo") }, body, base64 }));
    assert.equal(response.statusCode, 401);
  }
  assert.equal((await handler(httpEvent({ method: "POST", body }))).statusCode, 401);
  assert.equal(queue.drain().length, 0);
});

test("assinatura de bytes diferentes do que chegou é recusada (corpo adulterado em trânsito)", async () => {
  const { handler, queue } = setup();
  const body = textEvent({ body: "original" });
  const tampered = textEvent({ body: "adulterado" });
  const response = await handler(httpEvent({ method: "POST", headers: { "x-hub-signature-256": sign(body) }, body: tampered }));
  assert.equal(response.statusCode, 401);
  assert.equal(queue.drain().length, 0);
});

test("evento que não é uma requisição HTTP: 400; método estranho: 405", async () => {
  const { handler } = setup();
  assert.equal((await handler({ Records: [] })).statusCode, 400);
  assert.equal((await handler("texto")).statusCode, 400);
  assert.equal((await handler(httpEvent({ method: "PUT" }))).statusCode, 405);
});
