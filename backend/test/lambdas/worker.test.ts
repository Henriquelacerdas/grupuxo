import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerHandler } from "../../src/lambdas/worker.ts";
import type { IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import { sqsEvent, type SqsRecordOptions } from "./support.ts";

const phoneA = "+5511999998888";
const phoneB = "+5521988887777";

const record = (messageId: string, phone: string, options: { body?: string } = {}): SqsRecordOptions => ({
  messageId, group: phone,
  body: options.body ?? JSON.stringify({ wamid: `wamid.${messageId}`, phoneE164: phone, text: `texto ${messageId}`, receivedAt: 1 }),
});

function setup(failing: ReadonlySet<string> = new Set()) {
  const processed: string[] = [];
  const handler = createWorkerHandler({
    process: async (message: IncomingMessage) => {
      if (failing.has(message.wamid)) throw new Error("falha simulada");
      processed.push(message.wamid);
    },
  });
  return { processed, handler };
}

test("lote sem falhas: processa na ordem e não reporta nada", async () => {
  const { processed, handler } = setup();
  const result = await handler(sqsEvent(record("1", phoneA), record("2", phoneB), record("3", phoneA)));
  assert.deepEqual(result, { batchItemFailures: [] });
  assert.deepEqual(processed, ["wamid.1", "wamid.2", "wamid.3"]);
});

test("a mensagem recebe os campos do corpo (wamid, telefone, texto, horário)", async () => {
  const seen: IncomingMessage[] = [];
  const handler = createWorkerHandler({ process: async (message) => { seen.push(message); } });
  await handler(sqsEvent(record("1", phoneA)));
  assert.deepEqual(seen, [{ wamid: "wamid.1", phoneE164: phoneA, text: "texto 1", receivedAt: 1 }]);
});

test("a falha reporta o item e os seguintes do mesmo telefone, sem processá-los; outros telefones seguem", async () => {
  const { processed, handler } = setup(new Set(["wamid.2"]));
  const result = await handler(sqsEvent(
    record("1", phoneA), record("2", phoneA), record("3", phoneB), record("4", phoneA), record("5", phoneB),
  ));
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "2" }, { itemIdentifier: "4" }] });
  assert.deepEqual(processed, ["wamid.1", "wamid.3", "wamid.5"]);
});

test("corpo inválido (JSON ou forma errada) é reportado, e bloqueia só o grupo dele", async () => {
  const { processed, handler } = setup();
  const result = await handler(sqsEvent(
    record("1", phoneA, { body: "isto não é JSON" }),
    record("2", phoneA),
    record("3", phoneB, { body: JSON.stringify({ wamid: 1 }) }),
    record("4", phoneB),
    record("5", "+5531977776666"),
  ));
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "1" }, { itemIdentifier: "2" }, { itemIdentifier: "3" }, { itemIdentifier: "4" }] });
  assert.deepEqual(processed, ["wamid.5"]);
});

test("fila sem grupo: cada mensagem falha sozinha", async () => {
  const { processed, handler } = setup(new Set(["wamid.1"]));
  const withoutGroup = (messageId: string): SqsRecordOptions => ({
    messageId, body: JSON.stringify({ wamid: `wamid.${messageId}`, phoneE164: phoneA, text: "x", receivedAt: 1 }),
  });
  const result = await handler(sqsEvent(withoutGroup("1"), withoutGroup("2")));
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "1" }] });
  assert.deepEqual(processed, ["wamid.2"]);
});

test("a mensagem de erro do worker não vai para o resultado", async () => {
  const handler = createWorkerHandler({ process: async () => { throw new Error("segredo na mensagem de erro"); } });
  const result = await handler(sqsEvent(record("1", phoneA)));
  assert.ok(!JSON.stringify(result).includes("segredo"));
});

test("evento que não é um lote do SQS lança erro (o SQS devolve o lote inteiro)", async () => {
  const { handler } = setup();
  await assert.rejects(handler({ rawPath: "/" }), TypeError);
  await assert.rejects(handler(null), TypeError);
});
