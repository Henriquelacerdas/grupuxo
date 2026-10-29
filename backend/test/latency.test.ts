import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { LatencyMeasurement, measure, type LatencyReport } from "../src/latency.ts";
import { latencyRuntime } from "../src/main/latency.ts";
import { HttpGeminiClient, GeminiRequestError, type GeminiRequest } from "../src/assistant/gemini-client.ts";
import { GraphWhatsAppSender, GraphSendError } from "../src/whatsapp/graph-sender.ts";
import { WebhookHandler } from "../src/whatsapp/webhook/webhook-handler.ts";
import { createWorkerHandler } from "../src/lambdas/worker.ts";
import { parseSqsEvent } from "../src/lambdas/events.ts";
import { HouseStateStore } from "../src/adapters/dynamodb/house-state-store.ts";
import { housePK } from "../src/adapters/dynamodb/keys.ts";
import { FakeDynamoClient } from "./support/fake-dynamo-client.ts";
import { World } from "./support/world.ts";
import { instantRuntime } from "./dynamodb/environment.ts";
import { DynamoTransactionCanceledError } from "../src/adapters/dynamodb/client.ts";
import { GeminiMessageResponder } from "../src/assistant/gemini-responder.ts";
import { assistantDependencies, call, FakeGemini } from "./assistant/support.ts";

function instrumentation() {
  let time = 0;
  const reports: LatencyReport[] = [];
  const runtime = latencyRuntime((report) => reports.push(report), () => time, () => 100_000 + time);
  return { ...runtime, reports, advance: (ms: number) => { time += ms; } };
}
const privateText = "mensagem-privada telefone +5511999998888 wamid.privado token-secreto";
function assertPrivate(reports: readonly LatencyReport[]) {
  const serialized = JSON.stringify(reports);
  for (const value of [privateText, "mensagem-privada", "+5511999998888", "wamid.privado", "token-secreto"]) {
    assert.ok(!serialized.includes(value), serialized);
  }
}
const geminiRequest: GeminiRequest = {
  systemInstruction: "constante", contents: [{ role: "user", parts: [{ kind: "text", text: privateText }] }], functions: [],
};

test("telemetria: campos fechados, números finitos, samples sem dados extras e timer fecha uma vez", () => {
  let time = 0;
  const m = new LatencyMeasurement("message", () => time);
  const stop = m.start("graphMs");
  time = 12.34567;
  stop(); stop();
  m.add("houseLoads", 2); m.add("houseLoads", NaN); m.add("houseLoads", -1);
  Reflect.apply(m.add, m, [privateText, 42]);
  Reflect.apply(m.outcome, m, [privateText]);
  Reflect.apply(m.start, m, [privateText])();
  const sample = { durationMs: 4, outcome: "success", status: 200, text: privateText } as const;
  m.attempt(sample);
  const report = m.report();
  assert.equal(report.graphMs, 12.346);
  assert.equal(report.houseLoads, 2);
  assert.equal(report.geminiRounds, 0);
  assert.equal(report.queueDispatchMs, undefined, "timestamp ausente não vira zero");
  assert.deepEqual(report.geminiAttemptTimings, [{ durationMs: 4, outcome: "success", status: 200 }]);
  assertPrivate([report]);
});

test("telemetria: contextos concorrentes não compartilham contagens nem samples", async () => {
  const i = instrumentation();
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const a = i.scope.run("message", async () => {
    i.observer.add("houseLoads", 2);
    await gate;
    i.observer.add("houseLoads");
    i.observer.outcome("success");
  });
  await i.scope.run("message", async () => {
    i.observer.add("houseLoads", 7);
    i.observer.outcome("duplicate");
  });
  release(); await a;
  i.observer.add("houseLoads", 1000);
  assert.deepEqual(i.reports.map((r) => [r.houseLoads, r.outcome]), [[7, "duplicate"], [3, "success"]]);
  await i.scope.run("message", async () => { i.observer.outcome("success"); });
  assert.equal(i.reports[2]?.houseLoads, 0);
});

test("telemetria: falha do destino não muda retorno ou exceção do trabalho", async () => {
  const i = latencyRuntime(() => { throw new Error("log indisponível"); }, () => 1, () => 1);
  assert.equal(await i.scope.run("message", async () => 7), 7);
  const original = new Error(privateText);
  await assert.rejects(i.scope.run("message", async () => { throw original; }), (e) => e === original);
  const measured = instrumentation();
  await assert.rejects(measured.scope.run("message", async (o) => { o.outcome("success"); throw original; }));
  assert.equal(measured.reports[0]?.outcome, "failure");
});

test("Gemini: cronometra cada tentativa inclusive 503 recuperado e separa backoff", async () => {
  const i = instrumentation();
  let calls = 0;
  const client = new HttpGeminiClient({
    apiKey: "token-secreto", model: "gemini-3.1-flash-lite", latency: i.observer,
    sleep: async (ms) => { i.advance(ms); },
    http: async () => {
      i.advance(30);
      const status = ++calls === 1 ? 503 : 201;
      return { ok: status < 300, status, text: async () => {
        i.advance(10); return JSON.stringify({ candidates: [{ content: { parts: [] } }] });
      } };
    },
  });
  await i.scope.run("message", async (o) => { await client.generate(geminiRequest); o.outcome("success"); });
  const r = i.reports[0];
  assert.equal(r?.geminiAttempts, 2); assert.equal(r?.geminiRetries, 1);
  assert.equal(r?.geminiMs, 570); assert.equal(r?.geminiAttemptMs, 70); assert.equal(r?.geminiRetrySleepMs, 500);
  assert.deepEqual(r?.geminiAttemptTimings, [
    { durationMs: 30, outcome: "status", status: 503 }, { durationMs: 40, outcome: "success", status: 201 },
  ]);
  assertPrivate(i.reports);
});

test("Gemini: timeout do corpo também fecha o timer, preserva retry e não registra erro original", async () => {
  const i = instrumentation();
  const client = new HttpGeminiClient({ apiKey: "token-secreto", model: "gemini-3.1-flash-lite", latency: i.observer,
    sleep: async (ms) => { i.advance(ms); }, http: async () => ({ ok: true, status: 200, text: async () => {
      i.advance(12_000); throw Object.assign(new Error(privateText), { name: "TimeoutError" });
    } }),
  });
  await assert.rejects(i.scope.run("message", async () => client.generate(geminiRequest)), GeminiRequestError);
  const r = i.reports[0];
  assert.equal(r?.geminiMs, 24_500); assert.equal(r?.outcome, "failure");
  assert.deepEqual(r?.geminiAttemptTimings.map((s) => s.outcome), ["timeout", "timeout"]);
  assertPrivate(i.reports);
});

test("Graph: duração, corte e falha HTTP sem corpo/telefone/chave no relatório", async () => {
  const i = instrumentation();
  const sender = new GraphWhatsAppSender({ accessToken: "token-secreto", phoneNumberID: "12345", apiVersion: "v25.0",
    latency: i.observer, http: async () => { i.advance(45); return { ok: false, status: 401, text: async () => privateText }; },
  });
  await assert.rejects(i.scope.run("message", async () => sender.send(privateText.repeat(100), "+5511999998888")), GraphSendError);
  const r = i.reports[0];
  assert.equal(r?.graphMs, 45); assert.equal(r?.graphCalls, 1); assert.equal(r?.graphFailures, 1);
  assert.equal(r?.graphStatus, 401); assert.equal(r?.replyChars, 4096); assert.equal(r?.graphTruncations, 1);
  assertPrivate(i.reports);
});

test("digitando: falhas e cancelamento têm métricas próprias, sem conteúdo nem IDs", async () => {
  const i = instrumentation();
  const cancellation = new AbortController();
  let attempt = 0;
  const sender = new GraphWhatsAppSender({ accessToken: "token-secreto", phoneNumberID: "12345", apiVersion: "v25.0",
    latency: i.observer, http: async () => {
      i.advance(7);
      if (attempt++ === 0) return { ok: false, status: 503, text: async () => { throw new Error(privateText); } };
      if (attempt === 3) cancellation.abort();
      throw new Error(privateText);
    },
  });
  await i.scope.run("message", async (observer) => {
    for (let call = 0; call < 3; call++) await sender.showTyping("wamid.privado", cancellation.signal);
    observer.outcome("success");
  });
  const r = i.reports[0];
  assert.equal(r?.outcome, "success");
  assert.equal(r?.typingMs, 21); assert.equal(r?.typingCalls, 3);
  assert.equal(r?.typingFailures, 2); assert.equal(r?.typingCancellations, 1); assert.equal(r?.typingStatus, 503);
  assert.equal(r?.graphCalls, 0); assert.equal(r?.replyChars, 0);
  assertPrivate(i.reports);
});

test("SQS: separa espera inicial, reentrega e lote; registra grupo bloqueado sem seus IDs", async () => {
  const i = instrumentation();
  const handler = createWorkerHandler({ process: async () => { i.advance(40); throw new Error(privateText); } }, () => {}, i.scope);
  const body = JSON.stringify({ wamid: "wamid.privado", phoneE164: "+5511999998888", text: privateText, receivedAt: 90_000 });
  const record = { messageId: "id-privado", body, attributes: { MessageGroupId: "+5511999998888", SentTimestamp: "95000",
    ApproximateFirstReceiveTimestamp: "96000", ApproximateReceiveCount: "2" } };
  const result = await i.scope.run("batch", async () => {
    // Setup preguiçoso antes do handler não contamina o tempo até despacho.
    i.advance(200);
    return handler({ Records: [record, { ...record, messageId: "id-privado-2" }] });
  });
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "id-privado" }, { itemIdentifier: "id-privado-2" }]);
  const [first, blocked] = i.reports;
  assert.equal(first?.queueDispatchMs, 5000); assert.equal(first?.firstQueueWaitMs, 1000);
  assert.equal(first?.batchWaitMs, 200); assert.equal(first?.receiveCount, 2); assert.equal(first?.totalMs, 40);
  assert.equal(blocked?.outcome, "blocked_group"); assert.equal(blocked?.batchWaitMs, 240); assert.equal(blocked?.batchIndex, 1);
  assertPrivate(i.reports);
  assert.ok(!JSON.stringify(i.reports).includes("id-privado"));
});

test("SQS: atributos numéricos inválidos são opcionais, sem NaN nem perda da mensagem", () => {
  const [r] = parseSqsEvent({ Records: [{ messageId: "x", body: "{}", attributes: { SentTimestamp: "Infinity",
    ApproximateFirstReceiveTimestamp: "-1", ApproximateReceiveCount: "0" } }] }) ?? [];
  assert.deepEqual(r, { messageId: "x", body: "{}", messageGroupId: null });
});

test("webhook: mede só texto assinado, timestamp original/fallback e enqueue que falha", async () => {
  const i = instrumentation();
  let enqueued = 0;
  const webhook = new WebhookHandler({ appSecret: "token-secreto", verifyToken: "verify" }, { enqueue: async () => {
    i.advance(5); if (++enqueued === 2) throw new Error(privateText);
  } }, i.scope.wallNow, i.observer);
  const body = new TextEncoder().encode(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages",
    value: { messages: ["95", "inválido"].map((timestamp) => ({ from: "5511999998888", id: "wamid.privado", timestamp,
      type: "text", text: { body: privateText } })) } }] }] }));
  const signature = `sha256=${createHmac("sha256", "token-secreto").update(body).digest("hex")}`;
  const response = await i.scope.run("webhook", async () => webhook.handle({ method: "POST", body, headers: { "X-Hub-Signature-256": signature } }));
  assert.equal(response.statusCode, 500);
  const r = i.reports[0];
  assert.equal(r?.textMessages, 2); assert.equal(r?.timestampFallbacks, 1); assert.equal(r?.metaDeliveryMs, 5000);
  assert.equal(r?.enqueuedMessages, 1); assert.equal(r?.enqueueMs, 10);
  assertPrivate(i.reports);
});

test("casa: conta páginas/itens/perfis, leituras sem escrita e falha do comando sem perder duração", async () => {
  const i = instrumentation();
  const world = new World();
  const client = new FakeDynamoClient({ pageSize: 7 });
  const store = new HouseStateStore(client, instantRuntime, { latency: i.observer });
  await store.seedHouse(world.seed.state);
  const items = client.snapshot().filter((item) => item["PK"] === housePK(world.seed.house.id)).length;
  const writes = client.writes;
  await i.scope.run("message", async (o) => {
    const state = await store.read(world.seed.house.id, (state) => state);
    assert.equal(state.houses[0]?.id, world.seed.house.id);
    o.outcome("success");
  });
  const r = i.reports[0];
  assert.equal(r?.houseLoads, 1); assert.equal(r?.housePages, Math.ceil(items / 7)); assert.equal(r?.houseItems, items);
  assert.equal(r?.profileBatches, 1); assert.equal(r?.profiles, world.seed.state.users.length);
  assert.equal(r?.houseTransactions, 0); assert.equal(client.writes, writes);
  await assert.rejects(i.scope.run("message", async () => store.update(world.seed.house.id, () => {
    i.advance(13); throw new Error(privateText);
  })), Error);
  assert.equal(i.reports[1]?.houseCommandMs, 13); assert.equal(i.reports[1]?.houseUpdateMs, 13);
  assert.equal(client.writes, writes);
  assertPrivate(i.reports);
});

test("timer fecha também quando uma operação rejeita", async () => {
  const i = instrumentation();
  await assert.rejects(i.scope.run("message", async (o) => measure(o, "linkMs", async () => {
    i.advance(20); throw new Error(privateText);
  })));
  assert.equal(i.reports[0]?.linkMs, 20);
});

test("casa: conflito recarrega a partição e registra a tentativa sem alterar a transação", async () => {
  const i = instrumentation();
  const world = new World();
  const client = new FakeDynamoClient({ pageSize: 5000 });
  const store = new HouseStateStore(client, instantRuntime, { latency: i.observer });
  await store.seedHouse(world.seed.state);
  let attempts = 0;
  client.beforeTransact = async () => {
    if (++attempts === 1) throw new DynamoTransactionCanceledError(["ConditionalCheckFailed"]);
  };
  await i.scope.run("message", async () => store.update(world.seed.house.id, (s) => {
    s.notifications = [];
    const house = s.houses[0];
    assert.ok(house);
    // Mudança permitida no estado, sem alterar o META imutável.
    s.rooms = s.rooms.map((room) => ({ ...room, name: `${room.name}!` }));
  }));
  assert.equal(attempts, 2);
  assert.equal(i.reports[0]?.houseConflicts, 1);
  assert.equal(i.reports[0]?.houseTransactions, 2);
  assert.equal(i.reports[0]?.houseLoads, 2);
});

test("responder: conta rodadas de correção e cutoff sem registrar argumentos", async () => {
  for (const cutoff of [false, true]) {
    const i = instrumentation();
    const world = new World();
    const env = world.env();
    const gemini = new FakeGemini(...Array.from({ length: 3 }, () => [call("complete_task", { task_name: privateText })]));
    const responder = new GeminiMessageResponder({ ...assistantDependencies(env, () => world.now), now: () => world.now,
      latency: i.observer, gemini: { generate: async (request) => {
        const result = await gemini.generate(request);
        if (cutoff) world.now += 15_001;
        return result;
      } },
    });
    await i.scope.run("message", async () => responder.reply(privateText, world.seed.users.marina.id, { wamid: "wamid.privado" }));
    assert.equal(i.reports[0]?.geminiRounds, cutoff ? 1 : 3);
    assert.equal(i.reports[0]?.geminiCutoffs, cutoff ? 1 : 0);
    assert.equal(i.reports[0]?.toolProblems, cutoff ? 1 : 3);
    assertPrivate(i.reports);
  }
});
