import assert from "node:assert/strict";
import { test } from "node:test";
import { extractToken, generateToken, hashToken } from "../../src/whatsapp/linking/link-token-codec.ts";

const token = "0123456789abcdef0123456789abcdef";

test("o token gerado tem 128 bits em hexadecimal minúsculo", () => {
  const generated = generateToken();
  assert.equal(generated.length, 32);
  assert.match(generated, /^[0-9a-f]{32}$/);
});

test("tokens gerados são diferentes", () => {
  assert.notEqual(generateToken(), generateToken());
});

test("generate codifica os bytes aleatórios", () => {
  assert.equal(generateToken((count) => Uint8Array.from({ length: count }, (_, i) => i * 17)), "00112233445566778899aabbccddeeff");
});

test("o hash é o SHA-256 em hexadecimal do token em minúsculo", () => {
  // Vetor conhecido: SHA-256("abc").
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hashToken(token.toUpperCase()), hashToken(token));
});

test("extract acha o token na mensagem pré-preenchida e normaliza a caixa", () => {
  assert.equal(extractToken(`Conectar meu WhatsApp ao Grupuxo. Código: ${token}`), token);
  assert.equal(extractToken(`código: ${token.toUpperCase()}!`), token);
  assert.equal(extractToken(`(${token})`), token);
});

test("extract rejeita tamanho errado, não hexadecimal e ausência", () => {
  assert.equal(extractToken(token.slice(0, -1)), null);
  assert.equal(extractToken(`${token}a`), null);
  assert.equal(extractToken(`${token.slice(0, -1)}g`), null);
  assert.equal(extractToken("０".repeat(32)), null);
  assert.equal(extractToken("quais são minhas tarefas?"), null);
  assert.equal(extractToken(""), null);
});

test("extract devolve a primeira palavra no formato do token", () => {
  assert.equal(extractToken(`${token} fedcba9876543210fedcba9876543210`), token);
});

test("marcas combinantes fazem parte da palavra, como no Swift", () => {
  assert.equal(extractToken(`${token}́`), null);
  assert.equal(extractToken(`${token}_x`), token);
});
