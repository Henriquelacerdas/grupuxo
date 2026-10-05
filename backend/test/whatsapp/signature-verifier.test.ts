import assert from "node:assert/strict";
import { test } from "node:test";
import { constantTimeEquals, SignatureVerifier } from "../../src/whatsapp/webhook/signature-verifier.ts";
import { APP_SECRET, bytes, sign } from "./support.ts";

const verifier = new SignatureVerifier(APP_SECRET);
const body = bytes(`{"hello":"world"}`);

test("aceita a assinatura calculada pelo OpenSSL", () => {
  // printf '{"hello":"world"}' | openssl dgst -sha256 -hmac "segredo-do-app"
  const header = "sha256=e0e1b665be99797fb88f0868d687b3015590c90a431ad1ebad14ba49ecb65337";
  assert.ok(verifier.isValid(header, body));
  assert.ok(verifier.isValid(header.toUpperCase().replace("SHA256=", "sha256="), body));
});

test("rejeita corpo adulterado, segredo errado e cabeçalhos malformados", () => {
  const valid = sign(body);
  assert.ok(verifier.isValid(valid, body));
  assert.ok(!verifier.isValid(valid, bytes(`{"hello":"mundo"}`)));
  assert.ok(!verifier.isValid(sign(body, "outro"), body));
  assert.ok(!verifier.isValid(null, body));
  assert.ok(!verifier.isValid(undefined, body));
  assert.ok(!verifier.isValid("", body));
  assert.ok(!verifier.isValid("sha256=", body));
  assert.ok(!verifier.isValid("sha256=zz", body));
  assert.ok(!verifier.isValid("sha256=abc", body));
  assert.ok(!verifier.isValid(valid.slice(7), body));
  assert.ok(!verifier.isValid(`sha1${valid.slice(6)}`, body));
  assert.ok(!verifier.isValid(`SHA256=${valid.slice(7)}`, body));
});

test("segredo vazio falha fechado", () => {
  assert.ok(!new SignatureVerifier("").isValid(sign(body, ""), body));
});

test("a comparação em tempo constante compara conteúdo e tamanho", () => {
  assert.ok(constantTimeEquals("abc", "abc"));
  assert.ok(constantTimeEquals("", ""));
  assert.ok(!constantTimeEquals("abc", "abd"));
  assert.ok(!constantTimeEquals("abc", "abcd"));
  assert.ok(!constantTimeEquals("abc", ""));
  assert.ok(!constantTimeEquals("abc\0", "abc"));
});
