import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore, InMemoryWhatsAppSender } from "../../src/adapters/in-memory/whatsapp.ts";
import { GeminiMessageResponder, type GeminiMessageResponderDependencies } from "../../src/assistant/gemini-responder.ts";
import { isCompleted, type TaskItem } from "../../src/domain/entities.ts";
import { DomainError } from "../../src/domain/errors.ts";
import type { UserID } from "../../src/domain/ids.ts";
import { createLinkConfig, WhatsAppLinker } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import type { WhatsAppSender } from "../../src/whatsapp/ports.ts";
import { WhatsAppWorker } from "../../src/whatsapp/worker.ts";
import { World } from "../support/world.ts";
import { openRateLimiter } from "../whatsapp/support.ts";
import { assistantDependencies, call, FakeGemini, say, type Scripted } from "./support.ts";

// Conclusão pelo WhatsApp: o modelo só pede; quem conclui é o "sim" do morador, lido por código.

function setup(script: readonly Scripted[] = [], overrides: Partial<GeminiMessageResponderDependencies> = {}) {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const now = () => world.now;
  const dependencies = assistantDependencies(env, now);
  const gemini = new FakeGemini(...script);
  const responder = new GeminiMessageResponder({ ...dependencies, gemini, now, ...overrides });
  const { marina, leo } = world.seed.users;
  const tasksOf = (user: UserID): Promise<TaskItem[]> => dependencies.myTasks.execute(user, world.seed.house.id, "all");
  const pendingOf = async (user: UserID): Promise<TaskItem[]> => (await tasksOf(user)).filter((t) => !isCompleted(t.occurrence));
  const debts = () => env.store.read((state) => state.roomMemberships.map((m) => m.fairnessDebt));
  return { world, env, gemini, responder, pending: dependencies.pending, marina, leo, tasksOf, pendingOf, debts };
}

test("pedir não grava: o morador recebe a pergunta e a tarefa continua pendente", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, gemini, marina, pendingOf, debts } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  const before = { pending: (await pendingOf(marina.id)).length, debts: debts() };
  const reply = await responder.reply("terminei, tá feito", marina.id, { wamid: "wamid.1" });
  assert.equal(reply, `Marcar *${mine.definition.name}* como feita? Responda *sim* ou *não*.`);
  assert.equal(gemini.requests.length, 1);
  assert.equal((await pendingOf(marina.id)).length, before.pending);
  assert.deepEqual(debts(), before.debts);
});

test("\"sim\" conclui pelo domínio sem chamar o modelo; reentrega do mesmo wamid não duplica nada", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, gemini, marina, tasksOf, pendingOf, debts, world } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  const before = (await pendingOf(marina.id)).length;
  await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
  const debtsBefore = debts();
  world.now += 60_000;
  const reply = await responder.reply("sim", marina.id, { wamid: "wamid.2" });
  assert.equal(reply, `Pronto, marquei *${mine.definition.name}* como feita.`);
  assert.equal(gemini.requests.length, 1, "o \"sim\" não chega ao modelo");
  assert.equal((await pendingOf(marina.id)).length, before - 1);
  const done = (await tasksOf(marina.id)).find((t) => t.occurrence.id === mine.occurrence.id);
  assert.equal(done?.occurrence.completedByUserID, marina.id);
  const completedAt = done?.occurrence.completedAt;
  const debtsAfter = debts();
  assert.notDeepEqual(debtsAfter, debtsBefore, "a conclusão registrou o esforço uma vez");

  world.now += 60_000;
  assert.equal(await responder.reply("sim", marina.id, { wamid: "wamid.2" }), reply, "reentrega: mesma resposta");
  assert.deepEqual(debts(), debtsAfter, "reentrega: sem esforço em dobro");
  const again = (await tasksOf(marina.id)).find((t) => t.occurrence.id === mine.occurrence.id);
  assert.equal(again?.occurrence.completedAt, completedAt);
  assert.equal(gemini.requests.length, 1);
});

test("outro \"sim\" (wamid diferente) depois da confirmação não faz nada", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, marina, debts } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
  await responder.reply("sim", marina.id, { wamid: "wamid.2" });
  const after = debts();
  assert.equal(await responder.reply("sim", marina.id, { wamid: "wamid.3" }), GeminiMessageResponder.noPendingConfirmationReply);
  assert.deepEqual(debts(), after);
});

test("\"sim\" sem pedido não conclui nada e não chama o modelo", async () => {
  const { responder, gemini, marina, pendingOf } = setup();
  const before = (await pendingOf(marina.id)).length;
  assert.equal(await responder.reply("sim", marina.id, { wamid: "wamid.1" }), GeminiMessageResponder.noPendingConfirmationReply);
  assert.equal(gemini.requests.length, 0);
  assert.equal((await pendingOf(marina.id)).length, before);
});

test("\"não\" cancela: nada é concluído e um \"sim\" depois não tem o que confirmar", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, marina, pendingOf } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  const before = (await pendingOf(marina.id)).length;
  await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
  assert.equal(await responder.reply("não", marina.id, { wamid: "wamid.2" }), GeminiMessageResponder.declinedReply);
  assert.equal(await responder.reply("sim", marina.id, { wamid: "wamid.3" }), GeminiMessageResponder.noPendingConfirmationReply);
  assert.equal((await pendingOf(marina.id)).length, before);
});

test("pedido vencido não conclui (5 minutos por padrão, configurável)", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const request = [call("complete_task", { task_name: mine.definition.name })];
  for (const [lifetime, wait, concluded] of [[undefined, 299_000, true], [undefined, 300_000, false], [10, 11_000, false], [10, 9_000, true]] as const) {
    const { responder, world, marina, pendingOf } = setup([request], lifetime === undefined ? {} : { confirmationLifetimeSeconds: lifetime });
    const before = (await pendingOf(marina.id)).length;
    await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
    world.now += wait;
    const reply = await responder.reply("sim", marina.id, { wamid: "wamid.2" });
    assert.equal((await pendingOf(marina.id)).length, concluded ? before - 1 : before, `${String(lifetime)} ${wait}`);
    if (!concluded) assert.equal(reply, GeminiMessageResponder.noPendingConfirmationReply);
  }
});

test("só tarefas do próprio morador: a de outro não é encontrada e nada fica pendente", async () => {
  const probe = setup();
  const marinaNames = new Set((await probe.pendingOf(probe.marina.id)).map((t) => t.definition.name));
  const leoOnly = (await probe.pendingOf(probe.leo.id)).find((t) => !marinaNames.has(t.definition.name));
  assert.ok(leoOnly !== undefined, "a demonstração dá a Leo uma tarefa que Marina não tem");
  const { responder, marina, pending, debts } = setup([[call("complete_task", { task_name: leoOnly.definition.name })], []]);
  const before = debts();
  const reply = await responder.reply(`terminei ${leoOnly.definition.name}`, marina.id, { wamid: "wamid.1" });
  assert.ok(reply.startsWith(GeminiMessageResponder.unknownTaskReply), reply);
  assert.ok(!reply.includes(leoOnly.definition.name), reply);
  assert.equal(await pending.confirm(marina.id, "wamid.x", Number.MIN_SAFE_INTEGER), null);
  assert.equal(await responder.reply("sim", marina.id, { wamid: "wamid.2" }), GeminiMessageResponder.noPendingConfirmationReply);
  assert.deepEqual(debts(), before);
});

test("o pedido é de quem pediu: o \"sim\" de outro morador não conclui", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, marina, leo, pendingOf } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  const before = (await pendingOf(marina.id)).length;
  await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
  assert.equal(await responder.reply("sim", leo.id, { wamid: "wamid.2" }), GeminiMessageResponder.noPendingConfirmationReply);
  assert.equal((await pendingOf(marina.id)).length, before);
});

test("ocorrência, usuário e casa inventados pelo modelo são ignorados; só o nome conta", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  const theirs = (await probe.pendingOf(probe.leo.id)).find((t) => t.occurrence.id !== mine?.occurrence.id);
  assert.ok(mine !== undefined && theirs !== undefined);
  const args = { task_name: mine.definition.name, occurrence_id: theirs.occurrence.id, user_id: probe.leo.id, house_id: "x" };
  const { responder, marina, tasksOf } = setup([[call("complete_task", args)]]);
  await responder.reply("terminei", marina.id, { wamid: "wamid.1" });
  await responder.reply("sim", marina.id, { wamid: "wamid.2" });
  const items = await tasksOf(marina.id);
  assert.ok(items.find((t) => t.occurrence.id === mine.occurrence.id && isCompleted(t.occurrence)));
  assert.ok(!(await tasksOf(probe.leo.id)).some((t) => t.occurrence.id === theirs.occurrence.id && isCompleted(t.occurrence)));
});

test("o modelo dizer que concluiu não conclui: sem ferramenta, nada é pedido nem gravado", async () => {
  const { responder, marina, pendingOf, pending } = setup([[say("Pronto, marquei tudo como feito!")]]);
  const before = (await pendingOf(marina.id)).length;
  assert.equal(await responder.reply("terminei tudo", marina.id, { wamid: "wamid.1" }), GeminiMessageResponder.helpReply);
  assert.equal((await pendingOf(marina.id)).length, before);
  assert.equal(await pending.confirm(marina.id, "wamid.x", 0), null);
});

test("duas chamadas complete_task no mesmo turno geram um único pedido", async () => {
  const probe = setup();
  const [first, second] = await probe.pendingOf(probe.marina.id);
  assert.ok(first !== undefined && second !== undefined && first.definition.name !== second.definition.name);
  const { responder, marina, pendingOf } = setup([[
    call("complete_task", { task_name: first.definition.name }), call("complete_task", { task_name: second.definition.name }),
  ]]);
  const before = (await pendingOf(marina.id)).length;
  const reply = await responder.reply("terminei as duas", marina.id, { wamid: "wamid.1" });
  assert.equal((reply.match(/Marcar \*/g) ?? []).length, 1, reply);
  await responder.reply("sim", marina.id, { wamid: "wamid.2" });
  assert.equal((await pendingOf(marina.id)).length, before - 1);
});

test("um novo pedido substitui o anterior", async () => {
  const probe = setup();
  const [first, second] = await probe.pendingOf(probe.marina.id);
  assert.ok(first !== undefined && second !== undefined && first.definition.name !== second.definition.name);
  const { responder, marina, tasksOf } = setup([
    [call("complete_task", { task_name: first.definition.name })], [call("complete_task", { task_name: second.definition.name })],
  ]);
  await responder.reply("terminei a primeira", marina.id, { wamid: "wamid.1" });
  await responder.reply("na verdade a segunda", marina.id, { wamid: "wamid.2" });
  await responder.reply("sim", marina.id, { wamid: "wamid.3" });
  const items = await tasksOf(marina.id);
  assert.ok(!items.some((t) => t.occurrence.id === first.occurrence.id && isCompleted(t.occurrence)));
  assert.ok(items.some((t) => t.occurrence.id === second.occurrence.id && isCompleted(t.occurrence)));
});

test("nome que combina com várias tarefas pergunta qual, sem guardar pedido", async () => {
  const probe = setup();
  // Dois nomes diferentes que contêm "Limpar": a busca parcial é ambígua.
  const { responder, marina, pending } = setup([[call("complete_task", { task_name: "Limpar" })], []], {
    myTasks: { execute: async () => (await probe.tasksOf(probe.marina.id)).map((t, index) => index < 2 ? { ...t, definition: { ...t.definition, name: `Limpar ${index === 0 ? "bancada" : "fogão"}` } } : t) },
  });
  const reply = await responder.reply("terminei de limpar", marina.id, { wamid: "wamid.1" });
  assert.ok(reply.startsWith(GeminiMessageResponder.ambiguousTaskReply), reply);
  assert.ok(reply.includes("Limpar bancada") && reply.includes("Limpar fogão"), reply);
  assert.equal(await pending.confirm(marina.id, "wamid.x", 0), null);
});

test("se o domínio recusar a conclusão, o bot manda conferir no app; outros erros propagam", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const script = (): Scripted[] => [[call("complete_task", { task_name: mine.definition.name })]];
  const refused = setup(script(), { complete: { execute: async () => { throw new DomainError("taskUnavailable"); } } });
  await refused.responder.reply("terminei", refused.marina.id, { wamid: "wamid.1" });
  assert.equal(await refused.responder.reply("sim", refused.marina.id, { wamid: "wamid.2" }), GeminiMessageResponder.completionFailedReply);

  const broken = setup(script(), { complete: { execute: async () => { throw new Error("banco fora do ar"); } } });
  await broken.responder.reply("terminei", broken.marina.id, { wamid: "wamid.1" });
  await assert.rejects(broken.responder.reply("sim", broken.marina.id, { wamid: "wamid.2" }), /banco fora do ar/);
});

test("pelo worker: falha no envio da confirmação, reentrega do mesmo wamid conclui uma vez e responde", async () => {
  const probe = setup();
  const [mine] = await probe.pendingOf(probe.marina.id);
  assert.ok(mine !== undefined);
  const { responder, marina, world, debts, pendingOf } = setup([[call("complete_task", { task_name: mine.definition.name })]]);
  const links = new InMemoryWhatsAppLinkStore();
  const phone = "+5511999998888";
  await links.create({ userID: marina.id, phoneE164: phone, consentedAt: 0, linkedAt: 0 });
  const inner = new InMemoryWhatsAppSender();
  let failNext = false;
  const sender: WhatsAppSender = {
    send: async (text, to) => { if (failNext) { failNext = false; throw new Error("Graph fora do ar"); } await inner.send(text, to); },
  };
  const now = () => world.now;
  const worker = new WhatsAppWorker({
    inbox: new InMemoryInboxStore(), links, responder, sender, rateLimiter: openRateLimiter(), now,
    linker: new WhatsAppLinker(createLinkConfig("5511900000000"), new InMemoryLinkTokenStore(), links, now),
  });
  const message = (wamid: string, text: string) => ({ wamid, phoneE164: phone, text, receivedAt: world.now });
  const before = (await pendingOf(marina.id)).length;

  await worker.process(message("wamid.1", "terminei"));
  failNext = true;
  await assert.rejects(worker.process(message("wamid.2", "sim")), /Graph fora do ar/);
  const afterFirst = debts();
  assert.equal((await pendingOf(marina.id)).length, before - 1, "a conclusão já foi gravada");

  await worker.process(message("wamid.2", "sim")); // reentrega do SQS
  assert.deepEqual(debts(), afterFirst, "sem esforço em dobro");
  assert.equal(inner.sent.length, 2);
  assert.equal(inner.sent[1]?.text, `Pronto, marquei *${mine.definition.name}* como feita.`);
  await worker.process(message("wamid.2", "sim")); // duplicata depois de processada
  assert.equal(inner.sent.length, 2);
});
