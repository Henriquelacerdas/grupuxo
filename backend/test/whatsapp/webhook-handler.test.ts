import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMessageQueue } from "../../src/adapters/in-memory/whatsapp.ts";
import { parseIncomingMessage, type IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import type { MessageQueue } from "../../src/whatsapp/ports.ts";
import { WebhookHandler, type WebhookRequest } from "../../src/whatsapp/webhook/webhook-handler.ts";
import { APP_SECRET, VERIFY_TOKEN, bytes, payload, request, sign, textEvent } from "./support.ts";

const FALLBACK = 1_800_000_000_000;

function setup(queue: MessageQueue = new InMemoryMessageQueue()) {
  const inMemory = queue instanceof InMemoryMessageQueue ? queue : new InMemoryMessageQueue();
  const handler = new WebhookHandler({ verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET }, queue, () => FALLBACK);
  return { handler, queue: inMemory };
}

const get = (queryParameters: Record<string, string>): WebhookRequest => ({ method: "GET", queryParameters });
const signed = (body: Uint8Array) => request({ body, signature: sign(body) });

// MARK: Verificação (GET)

test("a verificação devolve o challenge", async () => {
  const { handler } = setup();
  const response = await handler.handle(get({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" }));
  assert.deepEqual(response, { statusCode: 200, body: "1158201444" });
});

test("a verificação rejeita token, modo ou parâmetros errados", async () => {
  const { handler } = setup();
  const invalid: Record<string, string>[] = [
    { "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "1" },
    { "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" },
    { "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" },
    { "hub.mode": "subscribe", "hub.challenge": "1" },
    { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN },
    {},
  ];
  for (const parameters of invalid) assert.equal((await handler.handle(get(parameters))).statusCode, 403);
});

test("a verificação falha fechada com token configurado vazio", async () => {
  const handler = new WebhookHandler({ verifyToken: "", appSecret: APP_SECRET }, new InMemoryMessageQueue(), () => FALLBACK);
  const response = await handler.handle(get({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }));
  assert.equal(response.statusCode, 403);
});

// MARK: Eventos (POST)

test("um evento de texto válido é enfileirado e confirmado", async () => {
  const { handler, queue } = setup();
  const response = await handler.handle(signed(textEvent()));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(queue.drain(), [
    { wamid: "wamid.A", phoneE164: "+5511999998888", text: "quais são minhas tarefas?", receivedAt: 1_700_000_000_000 },
  ]);
});

test("o cabeçalho é procurado sem diferenciar maiúsculas", async () => {
  const { handler, queue } = setup();
  const body = textEvent();
  const response = await handler.handle({ method: "post", headers: { "X-Hub-Signature-256": sign(body) }, body });
  assert.equal(response.statusCode, 200);
  assert.equal(queue.drain().length, 1);
});

test("assinatura inválida ou ausente é rejeitada sem enfileirar", async () => {
  const { handler, queue } = setup();
  const body = textEvent();
  assert.equal((await handler.handle(request({ body, signature: null }))).statusCode, 401);
  assert.equal((await handler.handle(request({ body, signature: sign(body, "outro") }))).statusCode, 401);
  assert.equal((await handler.handle(request({ body, signature: sign(textEvent({ body: "outra" })) }))).statusCode, 401);
  assert.equal(queue.drain().length, 0);
});

test("eventos de status são confirmados, mas ignorados", async () => {
  const { handler, queue } = setup();
  const body = payload({ statuses: `[{"id":"wamid.X","status":"delivered","timestamp":"1700000001","recipient_id":"5511999998888"}]` });
  assert.equal((await handler.handle(signed(body))).statusCode, 200);
  assert.equal(queue.drain().length, 0);
});

test("mensagens que não são texto e objetos estranhos são ignorados", async () => {
  const { handler, queue } = setup();
  const image = payload({ messages: `[{"from":"5511999998888","id":"wamid.I","timestamp":"1700000000","type":"image","image":{"id":"1","mime_type":"image/jpeg"}}]` });
  const foreign = bytes(new TextDecoder().decode(textEvent()).replace(`"whatsapp_business_account"`, `"instagram"`));
  const otherField = payload({
    messages: `[{"from":"5511999998888","id":"wamid.F","timestamp":"1700000000","type":"text","text":{"body":"oi"}}]`, field: "account_update",
  });
  for (const body of [image, foreign, otherField]) assert.equal((await handler.handle(signed(body))).statusCode, 200);
  assert.equal(queue.drain().length, 0);
});

test("mensagens em lote mantêm a ordem", async () => {
  const { handler, queue } = setup();
  const body = payload({
    messages: `[{"from":"5511999998888","id":"wamid.1","timestamp":"1700000000","type":"text","text":{"body":"um"}},
     {"from":"5511999998888","id":"wamid.2","timestamp":"1700000001","type":"image","image":{"id":"1"}},
     {"from":"5521988887777","id":"wamid.3","timestamp":"1700000002","type":"text","text":{"body":"três"}}]`,
  });
  await handler.handle(signed(body));
  assert.deepEqual(queue.drain().map((m) => m.wamid), ["wamid.1", "wamid.3"]);
});

test("sem timestamp, vale o relógio", async () => {
  const { handler, queue } = setup();
  await handler.handle(signed(payload({ messages: `[{"from":"5511999998888","id":"wamid.T","type":"text","text":{"body":"oi"}}]` })));
  assert.equal(queue.drain()[0]?.receivedAt, FALLBACK);
});

test("JSON malformado com assinatura válida é requisição inválida", async () => {
  const { handler } = setup();
  assert.equal((await handler.handle(signed(bytes("não é json")))).statusCode, 400);
});

test("falha na fila devolve 500 para a Meta tentar de novo", async () => {
  const failing: MessageQueue = { enqueue: () => Promise.reject(new Error("fila fora do ar")) };
  const { handler } = setup(failing);
  assert.equal((await handler.handle(signed(textEvent()))).statusCode, 500);
});

test("método não suportado devolve 405", async () => {
  const { handler } = setup();
  assert.equal((await handler.handle({ method: "PUT" })).statusCode, 405);
});

test("a mensagem sobrevive à serialização da fila", () => {
  const message: IncomingMessage = { wamid: "wamid.A", phoneE164: "+5511999998888", text: "oi", receivedAt: 1_700_000_000_000 };
  assert.deepEqual(parseIncomingMessage(JSON.parse(JSON.stringify(message))), message);
  assert.throws(() => parseIncomingMessage({ ...message, receivedAt: "ontem" }), TypeError);
  assert.throws(() => parseIncomingMessage(null), TypeError);
  assert.throws(() => parseIncomingMessage([message]), TypeError);
});

// MARK: Rigidez da decodificação (como o Decodable do Swift) e entrada hostil

test("campos obrigatórios ausentes ou com tipo errado invalidam o payload inteiro", async () => {
  const { handler, queue } = setup();
  const text = (extra: string) => `{"from":"5511999998888","id":"wamid.Z","type":"text","text":{"body":"oi"}${extra}}`;
  const invalid = [
    payload({ messages: `[{"id":"wamid.Z","type":"text","text":{"body":"oi"}}]` }),                               // sem from
    payload({ messages: `[{"from":"5511999998888","type":"text","text":{"body":"oi"}}]` }),                       // sem id
    payload({ messages: `[{"from":"5511999998888","id":"wamid.Z","text":{"body":"oi"}}]` }),                     // sem type
    payload({ messages: `[${text(`,"timestamp":1700000000`)}]` }),                                               // timestamp numérico
    payload({ messages: `[{"from":"5511999998888","id":"wamid.Z","type":"text","text":{"body":7}}]` }),          // body numérico
    payload({ messages: `[{"from":5511999998888,"id":"wamid.Z","type":"text","text":{"body":"oi"}}]` }),         // from numérico
    payload({ messages: `{"from":"1"}` }),                                                                       // messages não é lista
    bytes(`{"object":"whatsapp_business_account","entry":{"changes":[]}}`),                                       // entry não é lista
    bytes(`{"object":7}`),                                                                                       // object não é texto
    bytes(`[]`),                                                                                                 // raiz não é objeto
    bytes(`null`),
    bytes(``),
    new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]),                                                                    // UTF-8 inválido
  ];
  for (const body of invalid) assert.equal((await handler.handle(signed(body))).statusCode, 400, new TextDecoder().decode(body));
  assert.equal(queue.drain().length, 0);
});

test("valores nulos e campos extras são aceitos como ausentes", async () => {
  const { handler, queue } = setup();
  const body = bytes(
    `{"object":"whatsapp_business_account","extra":1,"entry":[{"changes":[{"field":null,"value":{"messages":[` +
      `{"from":"5511999998888","id":"wamid.N","timestamp":null,"type":"text","text":{"body":"oi"},"context":{"x":1}}]}}]},{"changes":null}]}`,
  );
  assert.equal((await handler.handle(signed(body))).statusCode, 200);
  assert.deepEqual(queue.drain().map((m) => [m.wamid, m.receivedAt]), [["wamid.N", FALLBACK]]);
});

test("timestamp não numérico ou fora do intervalo cai no relógio", async () => {
  const { handler, queue } = setup();
  for (const timestamp of ["abc", "1e9", "-5", "Infinity", "", "9999999999999999999999"]) {
    await handler.handle(signed(textEvent({ timestamp })));
  }
  assert.ok(queue.drain().every((m) => m.receivedAt === FALLBACK));
});

test("o telefone vira E.164 só com dígitos ASCII e mensagens sem remetente numérico são descartadas", async () => {
  const { handler, queue } = setup();
  await handler.handle(signed(textEvent({ from: "55 (11) 99999-8888" })));
  await handler.handle(signed(textEvent({ wamid: "wamid.X", from: "sem-digitos" })));
  await handler.handle(signed(textEvent({ wamid: "wamid.Y", body: "" })));
  assert.deepEqual(queue.drain().map((m) => m.phoneE164), ["+5511999998888"]);
});
