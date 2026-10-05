import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LambdaConfigError, parseApiSettings, parseWebhookSecrets, parseWorkerSecrets, parseWorkerSettings, type Environment,
} from "../../src/lambdas/config.ts";

const workerEnv: Environment = {
  GEMINI_MODEL: "gemini-2.5-flash-lite", WHATSAPP_GRAPH_VERSION: "v25.0", RATE_LIMIT_MAX_MESSAGES: "10", RATE_LIMIT_WINDOW_SECONDS: "60",
};
const apiEnv: Environment = { COGNITO_USER_POOL_ID: "us-east-1_M9GpISkE3", COGNITO_CLIENT_ID: "21gqeeehhmeufpipk84e3cc7tu", BOT_PHONE_NUMBER: "+5511900000000" };

const configError = (variable: string) => (error: unknown) => error instanceof LambdaConfigError && error.variable === variable;

test("configuração do worker: lê as quatro variáveis, sem padrões escondidos", () => {
  assert.deepEqual(parseWorkerSettings(workerEnv), {
    geminiModel: "gemini-2.5-flash-lite", graphVersion: "v25.0", rateLimit: { limit: 10, windowSeconds: 60 },
  });
  for (const name of Object.keys(workerEnv)) {
    assert.throws(() => parseWorkerSettings({ ...workerEnv, [name]: undefined }), configError(name), name);
    assert.throws(() => parseWorkerSettings({ ...workerEnv, [name]: "" }), configError(name), name);
  }
});

test("limite de taxa: só inteiros positivos em texto simples", () => {
  for (const name of ["RATE_LIMIT_MAX_MESSAGES", "RATE_LIMIT_WINDOW_SECONDS"]) {
    for (const value of ["0", "-1", "1.5", "1e3", "abc", " 10", "10 ", "010", "9999999999", "+5"]) {
      assert.throws(() => parseWorkerSettings({ ...workerEnv, [name]: value }), configError(name), `${name}=${value}`);
    }
  }
});

test("configuração da api: pool, client e número do bot", () => {
  const settings = parseApiSettings(apiEnv);
  assert.deepEqual(settings.cognito, { userPoolID: "us-east-1_M9GpISkE3", clientID: "21gqeeehhmeufpipk84e3cc7tu" });
  assert.equal(settings.link.botPhoneNumber, "5511900000000");
  for (const name of Object.keys(apiEnv)) assert.throws(() => parseApiSettings({ ...apiEnv, [name]: undefined }), configError(name), name);
  for (const value of ["abc", "123", "+55 11 90000-0000", "1".repeat(16)]) {
    assert.throws(() => parseApiSettings({ ...apiEnv, BOT_PHONE_NUMBER: value }), configError("BOT_PHONE_NUMBER"), value);
  }
});

test("o erro de configuração nunca repete o valor", () => {
  for (const [name, value] of [["RATE_LIMIT_MAX_MESSAGES", "valor-secreto"], ["RATE_LIMIT_WINDOW_SECONDS", "valor-secreto"]] as const) {
    try {
      parseWorkerSettings({ ...workerEnv, [name]: value });
      assert.fail("deveria lançar");
    } catch (error) {
      assert.ok(error instanceof Error && !error.message.includes(value));
    }
  }
  try {
    parseApiSettings({ ...apiEnv, BOT_PHONE_NUMBER: "valor-secreto" });
    assert.fail("deveria lançar");
  } catch (error) {
    assert.ok(error instanceof Error && !error.message.includes("valor-secreto"));
  }
});

const webhookSecret = JSON.stringify({ VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s", WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "123", GEMINI_API_KEY: "g" });

test("segredos: cada Lambda lê só as chaves que usa", () => {
  assert.deepEqual(parseWebhookSecrets(webhookSecret), { verifyToken: "v", appSecret: "s" });
  assert.deepEqual(parseWorkerSecrets(webhookSecret), { whatsappToken: "t", phoneNumberID: "123", geminiApiKey: "g" });
  assert.deepEqual(parseWebhookSecrets(JSON.stringify({ VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" })), { verifyToken: "v", appSecret: "s" });
});

test("segredos: chave ausente, vazia ou com tipo errado falha fechada, sem repetir o valor", () => {
  const all: Record<string, string> = { VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s", WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "123", GEMINI_API_KEY: "g" };
  const without = (name: string) => JSON.stringify(Object.fromEntries(Object.entries(all).filter(([key]) => key !== name)));
  assert.throws(() => parseWebhookSecrets(without("VERIFY_TOKEN")), configError("VERIFY_TOKEN"));
  assert.throws(() => parseWorkerSecrets(without("GEMINI_API_KEY")), configError("GEMINI_API_KEY"));
  assert.throws(() => parseWorkerSecrets(JSON.stringify({ WHATSAPP_TOKEN: "", PHONE_NUMBER_ID: "1", GEMINI_API_KEY: "g" })), configError("WHATSAPP_TOKEN"));
  assert.throws(() => parseWorkerSecrets(JSON.stringify({ WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: 123, GEMINI_API_KEY: "g" })), configError("PHONE_NUMBER_ID"));
  for (const bad of ["não é json", "[]", "null", '"texto"', ""]) {
    assert.throws(() => parseWebhookSecrets(bad), configError("segredo"), bad);
  }
  try {
    parseWorkerSecrets(JSON.stringify({ WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: ["valor-secreto"], GEMINI_API_KEY: "g" }));
    assert.fail("deveria lançar");
  } catch (error) {
    assert.ok(error instanceof Error && !error.message.includes("valor-secreto"));
  }
});

test("chaves herdadas do protótipo não contam como presentes", () => {
  assert.throws(() => parseWebhookSecrets("{}"), configError("VERIFY_TOKEN"));
});
