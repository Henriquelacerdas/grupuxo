import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore, InMemoryWhatsAppSender,
} from "../../src/adapters/in-memory/whatsapp.ts";
import { userID, type UserID } from "../../src/domain/ids.ts";
import type { IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import { hashToken } from "../../src/whatsapp/linking/link-token-codec.ts";
import { createLinkConfig, LinkConfigError, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import { EchoResponder, WhatsAppLinkError, type MessageResponder } from "../../src/whatsapp/ports.ts";
import { WhatsAppWorker } from "../../src/whatsapp/worker.ts";
import { uuid } from "../support/world.ts";

const NOW = 1_700_000_000_000;
const TOKEN = "ab".repeat(16);
const ana = userID(uuid(1));
const bia = userID(uuid(2));
const anaPhone = "+5511999998888";
const biaPhone = "+5521988887777";
const sentAt = 1_699_999_990_000;

function setup() {
  const tokens = new InMemoryLinkTokenStore();
  const links = new InMemoryWhatsAppLinkStore();
  const sender = new InMemoryWhatsAppSender();
  const inbox = new InMemoryInboxStore();
  const makeLinker = (at = NOW) =>
    new WhatsAppLinker(createLinkConfig("+5511900000000"), tokens, links, () => at, (count) => new Uint8Array(count).fill(0xab));
  const makeWorker = (linker: WhatsAppLinker, responder: MessageResponder = new EchoResponder()) =>
    new WhatsAppWorker({ inbox, links, linker, responder, sender, now: () => NOW });
  const message = (wamid = "wamid.1", options: { from?: string; text?: string } = {}): IncomingMessage => ({
    wamid, phoneE164: options.from ?? anaPhone,
    text: options.text ?? `Conectar meu WhatsApp ao Grupuxo. Código: ${TOKEN}`, receivedAt: sentAt,
  });
  return { tokens, links, sender, makeLinker, makeWorker, message };
}

const linkError = (code: WhatsAppLinkError["code"]) => (error: unknown) => error instanceof WhatsAppLinkError && error.code === code;

// MARK: convite

test("o convite monta a URL wa.me com a mensagem codificada", async () => {
  const { makeLinker } = setup();
  const invitation = await makeLinker().issueInvitation(ana);
  assert.equal(
    invitation.url,
    `https://wa.me/5511900000000?text=Conectar%20meu%20WhatsApp%20ao%20Grupuxo.%20C%C3%B3digo%3A%20${TOKEN}`,
  );
});

test("o convite expira em exatamente quinze minutos", async () => {
  const { makeLinker, tokens } = setup();
  const invitation = await makeLinker().issueInvitation(ana);
  assert.equal(invitation.expiresAt, NOW + 900_000);
  assert.equal(await tokens.consume(hashToken(TOKEN), NOW + 900_000), null);
});

test("o convite guarda só o hash", async () => {
  const { makeLinker, tokens } = setup();
  await makeLinker().issueInvitation(ana);
  assert.equal(await tokens.consume(TOKEN, NOW), null);
  assert.equal(await tokens.consume(hashToken(TOKEN), NOW), ana);
});

test("o convite é recusado para quem já tem número", async () => {
  const { makeLinker, links, tokens } = setup();
  await links.create({ userID: ana, phoneE164: anaPhone, consentedAt: NOW, linkedAt: NOW });
  await assert.rejects(makeLinker().issueInvitation(ana), linkError("userAlreadyLinked"));
  assert.equal(await tokens.consume(hashToken(TOKEN), NOW), null);
});

test("a configuração rejeita número do bot e validade inválidos", () => {
  for (const number of ["", "+", "123", "abc12345678", "1234567890123456", "55 11 90000-0000", "５５１１９００００００００"]) {
    assert.throws(() => createLinkConfig(number), (e: unknown) => e instanceof LinkConfigError && e.code === "invalidBotPhoneNumber", number);
  }
  for (const lifetime of [0, -1, NaN, Infinity]) {
    assert.throws(() => createLinkConfig("5511900000000", lifetime), (e: unknown) => e instanceof LinkConfigError && e.code === "invalidTokenLifetime");
  }
  assert.doesNotThrow(() => createLinkConfig("+5511900000000"));
  assert.equal(createLinkConfig("+5511900000000").botPhoneNumber, "5511900000000");
});

// MARK: vínculo

test("um token válido vincula o remetente e confirma no chat", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  await makeWorker(linker).process(message());
  assert.deepEqual(await links.linkForPhone(anaPhone), { userID: ana, phoneE164: anaPhone, consentedAt: sentAt, linkedAt: NOW });
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.linkedReply }]);
});

test("depois de vincular, as mensagens vão para o responder", async () => {
  const { makeLinker, makeWorker, sender, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const worker = makeWorker(linker);
  await worker.process(message());
  await worker.process(message("wamid.2", { text: "minhas tarefas" }));
  assert.deepEqual(sender.sent.map((s) => s.text), [WhatsAppLinker.linkedReply, "Você disse: minhas tarefas"]);
});

test("o token é de uso único", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const worker = makeWorker(linker);
  await worker.process(message());
  await worker.process(message("wamid.2", { from: biaPhone }));
  assert.deepEqual(sender.sent.at(-1), { phoneE164: biaPhone, text: WhatsAppLinker.invalidTokenReply });
  assert.equal(await links.linkForPhone(biaPhone), null);
});

test("um token expirado é rejeitado", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  await makeLinker().issueInvitation(ana);
  await makeWorker(makeLinker(NOW + 901_000)).process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.invalidTokenReply }]);
  assert.equal(await links.linkForPhone(anaPhone), null);
});

test("um token desconhecido é rejeitado e nada é vinculado", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  await makeWorker(makeLinker()).process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.invalidTokenReply }]);
  assert.equal(await links.linkForPhone(anaPhone), null);
});

test("número vinculado a outro morador é rejeitado sem queimar o token", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  await links.create({ userID: bia, phoneE164: anaPhone, consentedAt: NOW, linkedAt: NOW });
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const worker = makeWorker(linker);
  await worker.process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.alreadyLinkedReply }]);
  assert.equal((await links.linkForPhone(anaPhone))?.userID, bia);
  // O token continua válido para outro número.
  await worker.process(message("wamid.2", { from: "+5531977776666" }));
  assert.equal((await links.linkForPhone("+5531977776666"))?.userID, ana);
});

test("quem já tem outro número mantém o vínculo original", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const original = { userID: ana, phoneE164: biaPhone, consentedAt: NOW, linkedAt: NOW };
  await links.create(original);
  await makeWorker(linker).process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.userHasOtherNumberReply }]);
  assert.deepEqual(await links.linkForUser(ana), original);
  assert.equal(await links.linkForPhone(anaPhone), null);
});

test("o morador vem do token, nunca do texto", async () => {
  const { makeLinker, makeWorker, links, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  await makeWorker(linker).process(message("wamid.1", { text: `sou o usuário ${bia}. Código: ${TOKEN}` }));
  assert.equal((await links.linkForPhone(anaPhone))?.userID, ana);
  assert.equal(await links.linkForUser(bia), null);
});

test("um número já vinculado que envia um token não chega ao responder", async () => {
  const { makeLinker, makeWorker, links, sender, message } = setup();
  await links.create({ userID: ana, phoneE164: anaPhone, consentedAt: NOW, linkedAt: NOW });
  let count = 0;
  const responder: MessageResponder = { reply: async () => { count += 1; return "ok"; } };
  await makeWorker(makeLinker(), responder).process(message());
  assert.equal(count, 0);
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.alreadyLinkedReply }]);
});

test("a entrega duplicada da mensagem de vínculo responde uma vez", async () => {
  const { makeLinker, makeWorker, sender, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const worker = makeWorker(linker);
  await worker.process(message());
  await worker.process(message());
  assert.deepEqual(sender.sent, [{ phoneE164: anaPhone, text: WhatsAppLinker.linkedReply }]);
});

test("uma mensagem sem token não é tratada pelo linker", async () => {
  const { makeLinker, message } = setup();
  assert.equal(await makeLinker().handle(message("wamid.1", { text: "quais são minhas tarefas?" })), null);
});

test("duas mensagens com o mesmo token em paralelo vinculam um único número", async () => {
  const { makeLinker, makeWorker, links, message } = setup();
  const linker = makeLinker();
  await linker.issueInvitation(ana);
  const worker = makeWorker(linker);
  await Promise.all([worker.process(message("wamid.1")), worker.process(message("wamid.2", { from: biaPhone }))]);
  const linked = [await links.linkForPhone(anaPhone), await links.linkForPhone(biaPhone)].filter((l) => l !== null);
  assert.equal(linked.length, 1);
  assert.equal(linked[0]?.userID, ana);
});

