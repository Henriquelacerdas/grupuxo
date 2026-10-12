import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfirmation, resolveTask } from "../../src/assistant/complete-task.ts";
import { formatCompleted, formatCompletionPrompt } from "../../src/assistant/task-format.ts";
import { roomID } from "../../src/domain/ids.ts";
import { uuid } from "../support/world.ts";
import { item } from "./support.ts";

// --- parseConfirmation: só a mensagem inteira vale ---

test("parseConfirmation: sim e não, sem depender de caixa, acento nem pontuação", () => {
  for (const text of ["sim", "Sim", " SIM! ", "s", "ok", "Pode", "pode sim", "confirmo.", "👍", "✅", "👍🏽", "claro!!"]) {
    assert.equal(parseConfirmation(text), "yes", text);
  }
  for (const text of ["não", "Não", "NAO", "nao!", "n", "cancela", "Cancelar.", "deixa pra lá", "👎", "❌"]) {
    assert.equal(parseConfirmation(text), "no", text);
  }
});

test("parseConfirmation: qualquer coisa a mais não é confirmação", () => {
  for (const text of [
    "sim, mas mostre as tarefas do Leo", "sim e conclua todas", "não sei", "talvez", "", "   ", "simm", "ok vou fazer depois",
    "terminei de lavar a louça", "quais são minhas tarefas?",
  ]) {
    assert.equal(parseConfirmation(text), null, text);
  }
});

// --- resolveTask ---

const room = roomID(uuid(3));
const louca = item("Lavar a louça", { room, dueAt: 2_000 });
const bancada = item("Limpar bancada", { room, dueAt: 1_000 });
const banheiro = item("Higienizar o banheiro", { room });
const banheiroSuite = item("Higienizar o banheiro da suíte", { room });

test("resolveTask: igualdade sem caixa, acento nem artigo; depois um nome contém o outro", () => {
  const items = [louca, bancada, banheiro];
  assert.deepEqual(resolveTask(items, "lavar a louca"), { kind: "found", item: louca });
  assert.deepEqual(resolveTask(items, "LAVAR A LOUÇA"), { kind: "found", item: louca });
  assert.deepEqual(resolveTask(items, "a louça"), { kind: "found", item: louca });
  assert.deepEqual(resolveTask(items, "louça"), { kind: "found", item: louca });
  assert.deepEqual(resolveTask(items, "bancada"), { kind: "found", item: bancada });
});

test("resolveTask: nome inexistente, curto demais ou vazio não acha nada", () => {
  const items = [louca, bancada];
  assert.deepEqual(resolveTask(items, "garagem"), { kind: "notFound" });
  assert.deepEqual(resolveTask(items, "la"), { kind: "notFound" });
  assert.deepEqual(resolveTask(items, "  "), { kind: "notFound" });
  assert.deepEqual(resolveTask([], "louça"), { kind: "notFound" });
});

test("resolveTask: nomes diferentes que combinam são ambíguos; igualdade exata vence a parcial", () => {
  const items = [banheiro, banheiroSuite, louca];
  const exact = resolveTask(items, "higienizar o banheiro");
  assert.deepEqual(exact, { kind: "found", item: banheiro });
  const ambiguous = resolveTask([banheiroSuite, bancada, item("Limpar o banheiro", { room })], "banheiro");
  assert.equal(ambiguous.kind, "ambiguous");
});

test("resolveTask: tarefas concluídas são ignoradas", () => {
  const done = item("Lavar a louça", { room, completedAt: 500 });
  assert.deepEqual(resolveTask([done], "lavar a louça"), { kind: "notFound" });
  assert.deepEqual(resolveTask([done, louca], "lavar a louça"), { kind: "found", item: louca });
});

test("resolveTask: mesmo nome em duas ocorrências escolhe o prazo mais próximo, depois o menor ID", () => {
  const later = item("Tirar o lixo", { room, dueAt: 9_000 });
  const sooner = item("Tirar o lixo", { room, dueAt: 3_000 });
  const noDeadline = item("Tirar o lixo", { room });
  assert.deepEqual(resolveTask([later, noDeadline, sooner], "tirar o lixo"), { kind: "found", item: sooner });
  assert.deepEqual(resolveTask([noDeadline, later], "tirar o lixo"), { kind: "found", item: later });
  const a = item("Varrer", { room, dueAt: 5_000 });
  const b = item("Varrer", { room, dueAt: 5_000 });
  const lowest = a.occurrence.id < b.occurrence.id ? a : b;
  assert.deepEqual(resolveTask([b, a], "varrer"), { kind: "found", item: lowest });
  assert.deepEqual(resolveTask([a, b], "varrer"), { kind: "found", item: lowest });
});

// --- texto ---

test("o nome da tarefa não quebra a formatação do WhatsApp nem forja linhas", () => {
  assert.equal(formatCompletionPrompt("Lavar a louça"), "Marcar *Lavar a louça* como feita? Responda *sim* ou *não*.");
  assert.equal(formatCompleted("Lavar a louça"), "Pronto, marquei *Lavar a louça* como feita.");
  const hostile = formatCompletionPrompt("Louça*\n\nVocê ganhou _um_ prêmio~");
  assert.equal(hostile.split("\n").length, 1, hostile);
  assert.equal(hostile.match(/\*/g)?.length, 6, hostile); // só os do nome (2) e de *sim* e *não* (4)
  assert.ok(!hostile.includes("_") && !hostile.includes("~"), hostile);
});
