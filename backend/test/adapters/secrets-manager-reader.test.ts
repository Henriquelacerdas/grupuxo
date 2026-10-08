import assert from "node:assert/strict";
import { test } from "node:test";
import { SecretReadError, SecretStringReader } from "../../src/adapters/aws/secrets-manager-reader.ts";
import { LambdaConfigError, parseWebhookSecrets, parseWorkerSecrets } from "../../src/lambdas/config.ts";
import { FakeSecretsClient } from "./support.ts";

const SECRET_ID = "grupuxo/whatsapp";
const SECRET_STRING = JSON.stringify({
  VERIFY_TOKEN: "vt-teste", WHATSAPP_APP_SECRET: "app-teste", WHATSAPP_TOKEN: "EAAJB-teste",
  PHONE_NUMBER_ID: "106540352242922", GEMINI_API_KEY: "AIza-teste",
});

test("busca o segredo uma vez por instância, em chamadas sequenciais", async () => {
  const client = new FakeSecretsClient(async () => SECRET_STRING);
  const reader = new SecretStringReader({ client, secretID: SECRET_ID });
  assert.equal(await reader.read(), SECRET_STRING);
  assert.equal(await reader.read(), SECRET_STRING);
  assert.equal(client.calls, 1);
  assert.deepEqual(client.requested, [SECRET_ID]);
});

test("chamadas concorrentes compartilham a mesma busca", async () => {
  const client = new FakeSecretsClient(async () => SECRET_STRING);
  const reader = new SecretStringReader({ client, secretID: SECRET_ID });
  const values = await Promise.all([reader.read(), reader.read(), reader.read()]);
  assert.deepEqual(values, [SECRET_STRING, SECRET_STRING, SECRET_STRING]);
  assert.equal(client.calls, 1);
});

test("a falha não fica em cache: a chamada seguinte tenta de novo", async () => {
  let fail = true;
  const client = new FakeSecretsClient(async () => {
    if (fail) throw new Error("Throttled");
    return SECRET_STRING;
  });
  const reader = new SecretStringReader({ client, secretID: SECRET_ID });
  await assert.rejects(reader.read(), (error: unknown) => error instanceof SecretReadError && error.code === "readFailed");
  fail = false;
  assert.equal(await reader.read(), SECRET_STRING);
  assert.equal(client.calls, 2);
});

test("falhas concorrentes rejeitam todas e liberam nova tentativa", async () => {
  const client = new FakeSecretsClient(async () => { throw new Error("x"); });
  const reader = new SecretStringReader({ client, secretID: SECRET_ID });
  const results = await Promise.allSettled([reader.read(), reader.read()]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  assert.equal(client.calls, 1);
  await assert.rejects(reader.read());
  assert.equal(client.calls, 2);
});

test("erro do cliente vira erro de mensagem fixa, sem ID do segredo nem texto original", async () => {
  const original = new Error(`sem permissão em ${SECRET_ID} ${SECRET_STRING}`);
  original.name = "AccessDeniedException";
  const reader = new SecretStringReader({ client: new FakeSecretsClient(async () => { throw original; }), secretID: SECRET_ID });
  await assert.rejects(reader.read(), (error: unknown) => {
    assert.ok(error instanceof SecretReadError);
    assert.equal(error.code, "readFailed");
    assert.equal(error.causeName, "AccessDeniedException");
    assert.equal(error.cause, undefined);
    for (const text of [SECRET_ID, "EAAJB-teste", "sem permissão"]) assert.ok(!error.message.includes(text));
    return true;
  });
});

test("segredo sem SecretString (ausente ou vazio) falha com noSecretString", async () => {
  for (const response of [undefined, ""]) {
    const reader = new SecretStringReader({ client: new FakeSecretsClient(async () => response), secretID: SECRET_ID });
    await assert.rejects(reader.read(), (error: unknown) => error instanceof SecretReadError && error.code === "noSecretString");
  }
});

test("sem ID do segredo a criação falha fechada", () => {
  for (const secretID of [undefined, ""]) {
    assert.throws(() => new SecretStringReader({ client: new FakeSecretsClient(), secretID }), (error: unknown) => error instanceof LambdaConfigError && error.variable === "SECRET_ID");
  }
});

test("o SecretString lido alimenta os parsers de segredos do webhook e do worker", async () => {
  const reader = new SecretStringReader({ client: new FakeSecretsClient(async () => SECRET_STRING), secretID: SECRET_ID });
  assert.deepEqual(parseWebhookSecrets(await reader.read()), { verifyToken: "vt-teste", appSecret: "app-teste" });
  assert.deepEqual(parseWorkerSecrets(await reader.read()), {
    whatsappToken: "EAAJB-teste", phoneNumberID: "106540352242922", geminiApiKey: "AIza-teste",
  });
});
