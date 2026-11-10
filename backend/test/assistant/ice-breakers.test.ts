import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HELP_ICE_BREAKER, ICE_BREAKERS, iceBreakerProblems, isHelpIceBreaker,
} from "../../src/assistant/ice-breakers.ts";
import { GeminiMessageResponder } from "../../src/assistant/gemini-responder.ts";

test("os quebra-gelos canônicos respeitam os limites da Meta (até 4, até 80 caracteres, sem emoji)", () => {
  assert.deepEqual(iceBreakerProblems(ICE_BREAKERS), []);
  assert.deepEqual(ICE_BREAKERS, [
    "Quais as minhas tarefas da semana?",
    "Quais são todas as minhas tarefas?",
    "Tem alguma tarefa avulsa?",
    "O que você sabe fazer?",
  ]);
});

test("a validação aponta lista vazia, excesso, repetição, tamanho e emoji", () => {
  assert.deepEqual(iceBreakerProblems([]), ["nenhum quebra-gelo"]);
  assert.ok(iceBreakerProblems(["a", "b", "c", "d", "e"]).includes("mais de 4 quebra-gelos"));
  assert.ok(iceBreakerProblems(["a", "a"]).includes("quebra-gelos repetidos"));
  assert.deepEqual(iceBreakerProblems(["x".repeat(80)]), []);
  assert.deepEqual(iceBreakerProblems(["x".repeat(81)]), ["quebra-gelo 1 com mais de 80 caracteres"]);
  assert.deepEqual(iceBreakerProblems(["Oi 😀"]), ["quebra-gelo 1 com emoji"]);
  assert.deepEqual(iceBreakerProblems(["  "]), ["quebra-gelo 1 vazio"]);
});

test("os quebra-gelos de consulta repetem exemplos da ajuda fixa", () => {
  assert.ok(GeminiMessageResponder.helpReply.includes(ICE_BREAKERS[0] ?? "?"));
  assert.ok(GeminiMessageResponder.helpReply.includes(ICE_BREAKERS[2] ?? "?"));
});

test("só o texto exato do quebra-gelo de ajuda (sem diferenciar maiúsculas) é reconhecido", () => {
  assert.ok(isHelpIceBreaker(HELP_ICE_BREAKER));
  assert.ok(isHelpIceBreaker("  o que você sabe fazer? "));
  assert.ok(!isHelpIceBreaker("O que você sabe fazer? Marque limpar sala"));
  assert.ok(!isHelpIceBreaker("ajuda"));
});
