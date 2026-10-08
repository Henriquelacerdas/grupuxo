import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore, InMemoryWhatsAppSender,
} from "../../src/adapters/in-memory/whatsapp.ts";
import { InMemoryRateCounter } from "../../src/adapters/in-memory/rate-counter.ts";
import { userID, type UserID } from "../../src/domain/ids.ts";
import type { IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import { EchoResponder, type InboxStore, type MessageResponder } from "../../src/whatsapp/ports.ts";
import { MessageRateLimiter } from "../../src/whatsapp/rate-limit.ts";
import { WhatsAppWorker } from "../../src/whatsapp/worker.ts";
import { uuid } from "../support/world.ts";
import { openRateLimiter } from "./support.ts";

const PROCESSED_AT = 1_700_000_100_000;
const phone = "+5511999998888";
const id = userID(uuid(1));

function setup() {
  const inbox = new InMemoryInboxStore();
  const links = new InMemoryWhatsAppLinkStore();
  const sender = new InMemoryWhatsAppSender();
  const linker = new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => PROCESSED_AT);
  const makeWorker = (responder: MessageResponder = new EchoResponder()) =>
    new WhatsAppWorker({ inbox, links, linker, responder, sender, rateLimiter: openRateLimiter(), now: () => PROCESSED_AT });
  const message = (wamid = "wamid.A", text = "oi"): IncomingMessage => ({ wamid, phoneE164: phone, text, receivedAt: 1_700_000_000_000 });
  const link = () => links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  return { sender, makeWorker, message, link };
}

test("o morador vinculado recebe o eco", async () => {
  const { sender, makeWorker, message, link } = setup();
  await link();
  await makeWorker().process(message("wamid.A", "minhas tarefas"));
  assert.deepEqual(sender.sent, [{ phoneE164: phone, text: "Você disse: minhas tarefas" }]);
});

test("o responder recebe o morador do vínculo, nunca do texto", async () => {
  const { makeWorker, message, link } = setup();
  await link();
  const calls: UserID[] = [];
  const responder: MessageResponder = { reply: async (_text, user) => { calls.push(user); return "ok"; } };
  await makeWorker(responder).process(message("wamid.A", "sou o usuário 00000000-0000-0000-0000-000000000000"));
  assert.deepEqual(calls, [id]);
});

test("número desconhecido é orientado a vincular e o responder não é chamado", async () => {
  const { sender, makeWorker, message } = setup();
  let called = false;
  const responder: MessageResponder = { reply: async () => { called = true; return "ok"; } };
  await makeWorker(responder).process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: phone, text: WhatsAppWorker.unlinkedReply }]);
  assert.equal(called, false);
});

test("a entrega duplicada responde uma vez", async () => {
  const { sender, makeWorker, message, link } = setup();
  await link();
  const worker = makeWorker();
  await worker.process(message());
  await worker.process(message());
  assert.equal(sender.sent.length, 1);
});

test("mensagens diferentes do mesmo telefone são todas respondidas", async () => {
  const { sender, makeWorker, message, link } = setup();
  await link();
  const worker = makeWorker();
  await worker.process(message("wamid.1", "a"));
  await worker.process(message("wamid.2", "b"));
  assert.deepEqual(sender.sent.map((s) => s.text), ["Você disse: a", "Você disse: b"]);
});

test("uma tentativa que falhou é refeita em vez de perdida", async () => {
  const { sender, makeWorker, message, link } = setup();
  await link();
  let failures = 1;
  const flaky: MessageResponder = {
    reply: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("falha transitória");
      }
      return "ok";
    },
  };
  const worker = makeWorker(flaky);
  await assert.rejects(worker.process(message()), /falha transitória/);
  assert.equal(sender.sent.length, 0);
  await worker.process(message());
  assert.equal(sender.sent.length, 1);
  await worker.process(message());
  assert.equal(sender.sent.length, 1);
});

test("a caixa de entrada só recebe o wamid e os horários, nunca o texto", async () => {
  const links = new InMemoryWhatsAppLinkStore();
  const calls: unknown[][] = [];
  const spy: InboxStore = {
    claim: async (...args) => { calls.push(["claim", ...args]); return "claimed"; },
    markProcessed: async (...args) => { calls.push(["markProcessed", ...args]); },
  };
  const linker = new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => PROCESSED_AT);
  const worker = new WhatsAppWorker({ inbox: spy, links, linker, responder: new EchoResponder(), sender: new InMemoryWhatsAppSender(), rateLimiter: openRateLimiter(), now: () => PROCESSED_AT });
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await worker.process({ wamid: "wamid.S", phoneE164: phone, text: "texto que não pode ser persistido", receivedAt: 1_700_000_000_000 });
  assert.deepEqual(calls, [["claim", "wamid.S", 1_700_000_000_000], ["markProcessed", "wamid.S", PROCESSED_AT]]);
  assert.ok(!JSON.stringify(calls).includes("texto"));
});

// --- limite de taxa por número ---

function rateLimitedSetup(limit: number) {
  const inbox = new InMemoryInboxStore();
  const links = new InMemoryWhatsAppLinkStore();
  const sender = new InMemoryWhatsAppSender();
  const linker = new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => PROCESSED_AT);
  let clock = PROCESSED_AT;
  const replies: string[] = [];
  const responder: MessageResponder = { reply: async (text) => { replies.push(text); return `ok ${text}`; } };
  const worker = new WhatsAppWorker({
    inbox, links, linker, responder, sender, now: () => clock,
    rateLimiter: new MessageRateLimiter({ counter: new InMemoryRateCounter(), limit, windowSeconds: 60 }),
  });
  const message = (wamid: string, from = phone): IncomingMessage => ({ wamid, phoneE164: from, text: wamid, receivedAt: 1_700_000_000_000 });
  return { inbox, links, sender, worker, replies, message, setClock: (value: number) => { clock = value; } };
}

test("estourado o limite, o bot avisa uma vez por janela e descarta o resto sem chamar o responder", async () => {
  const { links, sender, worker, replies, message } = rateLimitedSetup(2);
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  for (const wamid of ["w1", "w2", "w3", "w4", "w5"]) await worker.process(message(wamid));
  assert.deepEqual(replies, ["w1", "w2"]);
  assert.deepEqual(sender.sent.map((s) => s.text), ["ok w1", "ok w2", WhatsAppWorker.rateLimitedReply]);
});

test("a mensagem barrada conta como processada: reentrega não responde nem avisa de novo", async () => {
  const { links, sender, worker, message } = rateLimitedSetup(1);
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await worker.process(message("w1"));
  await worker.process(message("w2"));
  await worker.process(message("w2"));
  assert.deepEqual(sender.sent.map((s) => s.text), ["ok w1", WhatsAppWorker.rateLimitedReply]);
});

test("na janela seguinte o número volta a ser atendido", async () => {
  const { links, sender, worker, message, setClock } = rateLimitedSetup(1);
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await worker.process(message("w1"));
  await worker.process(message("w2"));
  setClock(PROCESSED_AT + 120_000);
  await worker.process(message("w3"));
  assert.deepEqual(sender.sent.map((s) => s.text), ["ok w1", WhatsAppWorker.rateLimitedReply, "ok w3"]);
});

test("o limite é por número: outro telefone não é afetado", async () => {
  const { links, sender, worker, message } = rateLimitedSetup(1);
  const other = "+5521988887777";
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await links.create({ userID: userID(uuid(2)), phoneE164: other, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await worker.process(message("w1"));
  await worker.process(message("w2"));
  await worker.process(message("w3", other));
  assert.deepEqual(sender.sent.map((s) => [s.phoneE164, s.text]), [[phone, "ok w1"], [phone, WhatsAppWorker.rateLimitedReply], [other, "ok w3"]]);
});

test("número desconhecido também é limitado: o aviso de vínculo não vira spam", async () => {
  const { sender, worker, message } = rateLimitedSetup(1);
  for (const wamid of ["w1", "w2", "w3"]) await worker.process(message(wamid));
  assert.deepEqual(sender.sent.map((s) => s.text), [WhatsAppWorker.unlinkedReply, WhatsAppWorker.rateLimitedReply]);
});

test("falha ao avisar deixa a mensagem para nova tentativa, que a descarta em silêncio", async () => {
  const { links, inbox, worker, message } = rateLimitedSetup(1);
  await links.create({ userID: id, phoneE164: phone, consentedAt: PROCESSED_AT, linkedAt: PROCESSED_AT });
  await worker.process(message("w1"));
  const failing = new WhatsAppWorker({
    inbox, links,
    linker: new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, () => PROCESSED_AT),
    responder: new EchoResponder(),
    sender: { send: async () => { throw new Error("Graph fora do ar"); } },
    // Contador compartilhado com `worker` não existe aqui: força o aviso (primeira acima do limite).
    rateLimiter: { check: async () => "limitedFirst" },
    now: () => PROCESSED_AT,
  });
  await assert.rejects(failing.process(message("w2")), /Graph fora do ar/);
  assert.equal(await inbox.claim("w2", 0), "claimed");
});
