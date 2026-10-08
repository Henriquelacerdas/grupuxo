import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageQueueError, SqsMessageQueue } from "../../src/adapters/aws/sqs-message-queue.ts";
import { InMemoryMessageQueue } from "../../src/adapters/in-memory/whatsapp.ts";
import { LambdaConfigError } from "../../src/lambdas/config.ts";
import { parseIncomingMessage, type IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import { messageQueueContract } from "../contract/message-queue.ts";
import { FakeSqsClient } from "./support.ts";

const QUEUE_URL = "https://sqs.sa-east-1.amazonaws.com/123456789012/grupuxo-dev.fifo";
const PHONE = "+5511999998888";
const WAMID = "wamid.HBgMNTUxMTk5OTk5ODg4OBUCABIYFjNFQjA=";
const TEXT = "o que eu faço hoje? segredo-do-usuario";

const incoming = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  wamid: WAMID, phoneE164: PHONE, text: TEXT, receivedAt: 1_700_000_000_000, ...overrides,
});

messageQueueContract("em memória", () => {
  const queue = new InMemoryMessageQueue();
  return { queue, delivered: async () => queue.drain() };
});

messageQueueContract("SQS (cliente falso)", () => {
  const client = new FakeSqsClient();
  return {
    queue: new SqsMessageQueue({ client, queueURL: QUEUE_URL }),
    delivered: async () => client.sent.splice(0).map((item) => parseIncomingMessage(JSON.parse(item.body))),
  };
});

test("SQS: grupo = telefone, deduplicação = wamid e fila = URL configurada", async () => {
  const client = new FakeSqsClient();
  await new SqsMessageQueue({ client, queueURL: QUEUE_URL }).enqueue(incoming());
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0]?.queueURL, QUEUE_URL);
  assert.equal(client.sent[0]?.messageGroupID, PHONE);
  assert.equal(client.sent[0]?.messageDeduplicationID, WAMID);
});

test("SQS: o corpo tem só os quatro campos da mensagem", async () => {
  const client = new FakeSqsClient();
  const extra = { ...incoming(), userID: "nao-deve-ir" };
  await new SqsMessageQueue({ client, queueURL: QUEUE_URL }).enqueue(extra);
  const body: unknown = JSON.parse(client.sent[0]?.body ?? "null");
  assert.deepEqual(body, incoming());
});

test("SQS: IDs que o FIFO recusaria não chegam ao cliente", async () => {
  const client = new FakeSqsClient();
  const queue = new SqsMessageQueue({ client, queueURL: QUEUE_URL });
  for (const bad of [
    incoming({ wamid: "" }), incoming({ phoneE164: "" }), incoming({ wamid: "w".repeat(129) }),
    incoming({ phoneE164: "+55 11 99999" }), incoming({ wamid: "wamid.é" }),
  ]) {
    await assert.rejects(queue.enqueue(bad), (error: unknown) => error instanceof MessageQueueError && error.code === "invalidMessage");
  }
  assert.equal(client.sent.length, 0);
});

test("SQS: falha do cliente vira erro de mensagem fixa, sem conteúdo, telefone, wamid nem URL", async () => {
  const client = new FakeSqsClient();
  const original = new Error(`AccessDenied em ${QUEUE_URL} para ${PHONE} ${WAMID} ${TEXT}`);
  original.name = "AccessDeniedException";
  client.failWith = original;
  await assert.rejects(new SqsMessageQueue({ client, queueURL: QUEUE_URL }).enqueue(incoming()), (error: unknown) => {
    assert.ok(error instanceof MessageQueueError);
    assert.equal(error.code, "sendFailed");
    assert.equal(error.causeName, "AccessDeniedException");
    assert.equal(error.cause, undefined);
    for (const secret of [QUEUE_URL, PHONE, WAMID, TEXT, "AccessDenied em"]) assert.ok(!error.message.includes(secret));
    return true;
  });
});

test("SQS: falha que não é Error não vaza nada", async () => {
  const client = new FakeSqsClient();
  client.sendMessage = async () => { throw TEXT; };
  await assert.rejects(new SqsMessageQueue({ client, queueURL: QUEUE_URL }).enqueue(incoming()), (error: unknown) => {
    assert.ok(error instanceof MessageQueueError);
    assert.equal(error.causeName, null);
    return true;
  });
});

test("SQS: sem URL da fila a criação falha fechada", () => {
  const client = new FakeSqsClient();
  for (const queueURL of [undefined, ""]) {
    assert.throws(() => new SqsMessageQueue({ client, queueURL }), (error: unknown) => error instanceof LambdaConfigError && error.variable === "QUEUE_URL");
  }
});
