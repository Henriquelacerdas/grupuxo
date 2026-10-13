import assert from "node:assert/strict";
import { test } from "node:test";
import { InProcessMessageQueue } from "../../src/adapters/local/in-process-queue.ts";
import type { IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import { messageQueueContract } from "../contract/message-queue.ts";

function message(wamid: string, phoneE164 = "+5511999998888"): IncomingMessage {
  return { wamid, phoneE164, text: "oi", receivedAt: 0 };
}

const gate = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};

test("mensagens do mesmo telefone rodam em ordem, uma por vez", async () => {
  const log: string[] = [];
  const first = gate();
  const queue = new InProcessMessageQueue({
    process: async (m) => {
      log.push(`start ${m.wamid}`);
      if (m.wamid === "1") await first.promise;
      log.push(`end ${m.wamid}`);
    },
    onDropped: () => assert.fail("não deveria descartar"),
  });
  await queue.enqueue(message("1"));
  await queue.enqueue(message("2"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ["start 1"]);
  first.open();
  await queue.idle();
  assert.deepEqual(log, ["start 1", "end 1", "start 2", "end 2"]);
});

test("telefones diferentes andam em paralelo", async () => {
  const blocked = gate();
  const done: string[] = [];
  const queue = new InProcessMessageQueue({
    process: async (m) => {
      if (m.phoneE164 === "+5511911110000") await blocked.promise;
      done.push(m.wamid);
    },
    onDropped: () => assert.fail("não deveria descartar"),
  });
  await queue.enqueue(message("lento", "+5511911110000"));
  await queue.enqueue(message("rapido", "+5511922220000"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(done, ["rapido"]);
  blocked.open();
  await queue.idle();
  assert.deepEqual(done, ["rapido", "lento"]);
});

test("falha tenta de novo e, esgotadas as tentativas, descarta e segue com a próxima", async () => {
  const attempts = new Map<string, number>();
  const processed: string[] = [];
  let dropped = 0;
  const queue = new InProcessMessageQueue({
    process: async (m) => {
      attempts.set(m.wamid, (attempts.get(m.wamid) ?? 0) + 1);
      if (m.wamid === "ruim" || (m.wamid === "instavel" && attempts.get("instavel") === 1)) throw new Error("falhou");
      processed.push(m.wamid);
    },
    onDropped: () => { dropped += 1; },
    retryDelayMs: 0,
  });
  await queue.enqueue(message("instavel"));
  await queue.enqueue(message("ruim"));
  await queue.enqueue(message("depois"));
  await queue.idle();
  assert.deepEqual(processed, ["instavel", "depois"]);
  assert.equal(attempts.get("instavel"), 2);
  assert.equal(attempts.get("ruim"), 3);
  assert.equal(dropped, 1);
});

messageQueueContract("em processo", () => {
  const delivered: IncomingMessage[] = [];
  const queue = new InProcessMessageQueue({ process: async (m) => { delivered.push(m); }, onDropped: () => {} });
  return { queue, delivered: async () => { await queue.idle(); return delivered; } };
});
