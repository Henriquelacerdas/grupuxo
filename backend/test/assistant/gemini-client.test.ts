import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GeminiConfigurationError, GeminiRequestError, HttpGeminiClient, parseResponse, type GeminiRequest,
} from "../../src/assistant/gemini-client.ts";
import { READ_ONLY_FUNCTIONS } from "../../src/assistant/read-tools.ts";
import type { HttpFetch, HttpRequestInit, HttpResponse } from "../../src/http.ts";

const API_KEY = "AIzaSy-chave-secreta-de-teste";
const MODEL = "gemini-2.5-flash-lite";

interface Recorded {
  readonly url: string;
  readonly init: HttpRequestInit;
}

const reply = (body: string, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, text: async () => body });

function fakeHttp(respond: () => HttpResponse | Promise<HttpResponse>): { http: HttpFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { http, calls };
}

const textBody = (text: string): string => JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] });

const request: GeminiRequest = {
  systemInstruction: "instrução fixa",
  contents: [{ role: "user", parts: [{ kind: "text", text: "quais são minhas tarefas?" }] }],
  functions: READ_ONLY_FUNCTIONS,
};

function client(http: HttpFetch, overrides: Partial<ConstructorParameters<typeof HttpGeminiClient>[0]> = {}): HttpGeminiClient {
  return new HttpGeminiClient({ apiKey: API_KEY, model: MODEL, http, ...overrides });
}

// --- configuração: falha fechada ---

test("sem GEMINI_MODEL o cliente não é criado: não existe modelo escondido", () => {
  const { http } = fakeHttp(() => reply("{}"));
  for (const model of [undefined, ""]) {
    assert.throws(() => client(http, { model }), GeminiConfigurationError);
  }
});

test("o nome do modelo entra na URL, então só aceita letras minúsculas, dígitos, ponto e hífen", () => {
  const { http } = fakeHttp(() => reply("{}"));
  for (const model of ["../x", "a/b", "a:b", "a?b", "a#b", "a%2fb", "A", "Gemini-2.5", "a b", "a\nb", "-a", ".a", "..", "a_b", "x".repeat(65)]) {
    assert.throws(() => client(http, { model }), GeminiConfigurationError, model);
  }
  for (const model of ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash", "x"]) {
    assert.doesNotThrow(() => client(http, { model }), model);
  }
});

test("chave ausente ou com espaço/quebra de linha é erro de configuração, sem repetir a chave", () => {
  const { http } = fakeHttp(() => reply("{}"));
  for (const apiKey of [undefined, "", "tem espaço", "quebra\nde linha", "x".repeat(513)]) {
    assert.throws(() => client(http, { apiKey }), GeminiConfigurationError);
  }
  try {
    client(http, { apiKey: "chave com espaço" });
    assert.fail("deveria lançar");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("chave com espaço"));
  }
});

test("timeout e teto de tokens precisam ser inteiros positivos", () => {
  const { http } = fakeHttp(() => reply("{}"));
  for (const timeoutMs of [0, -1, 1.5, Number.NaN]) assert.throws(() => client(http, { timeoutMs }), GeminiConfigurationError);
  for (const maxOutputTokens of [0, -5, 2.5, Number.NaN]) assert.throws(() => client(http, { maxOutputTokens }), GeminiConfigurationError);
});

// --- requisição ---

test("POST na URL do modelo, com a chave só no cabeçalho, timeout, teto de tokens e modo AUTO", async () => {
  const { http, calls } = fakeHttp(() => reply(textBody("oi")));
  await client(http, { maxOutputTokens: 256 }).generate(request);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call?.url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
  assert.equal(call?.init.method, "POST");
  assert.equal(call?.init.headers?.["x-goog-api-key"], API_KEY);
  assert.equal(call?.init.headers?.["content-type"], "application/json");
  assert.ok(call?.init.signal instanceof AbortSignal);
  assert.ok(!call?.url.includes(API_KEY) && !call?.url.includes("key="));
  assert.ok(!call?.init.body?.includes(API_KEY));
  const body: unknown = JSON.parse(call?.init.body ?? "null");
  assert.deepEqual(body, {
    systemInstruction: { parts: [{ text: "instrução fixa" }] },
    contents: [{ role: "user", parts: [{ text: "quais são minhas tarefas?" }] }],
    tools: [{ functionDeclarations: JSON.parse(JSON.stringify(READ_ONLY_FUNCTIONS)) }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { maxOutputTokens: 256, temperature: 0 },
  });
});

test("as ferramentas declaradas não têm parâmetro de usuário nem de casa", () => {
  assert.deepEqual(READ_ONLY_FUNCTIONS.map((f) => f.name), ["list_my_tasks", "list_room_tasks", "list_sporadic_tasks"]);
  const parameterNames = READ_ONLY_FUNCTIONS.flatMap((f) => Object.keys(f.parameters?.properties ?? {}));
  assert.deepEqual(parameterNames, ["range", "room_name"]);
  assert.ok(!/user|house|casa|morador/i.test(parameterNames.join(" ")));
});

test("a conversa de volta ao modelo preserva id e assinatura da chamada e serializa a resposta da ferramenta", async () => {
  const { http, calls } = fakeHttp(() => reply(textBody("ok")));
  await client(http).generate({
    ...request,
    contents: [
      request.contents[0] ?? { role: "user", parts: [] },
      { role: "model", parts: [{ kind: "functionCall", name: "list_room_tasks", args: { room_name: "x" }, id: "c1", thoughtSignature: "sig" }] },
      { role: "user", parts: [{ kind: "functionResponse", name: "list_room_tasks", response: { error: "room_not_found" }, id: "c1" }] },
    ],
  });
  const body: unknown = JSON.parse(calls[0]?.init.body ?? "null");
  assert.ok(typeof body === "object" && body !== null && "contents" in body);
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: "quais são minhas tarefas?" }] },
    { role: "model", parts: [{ functionCall: { name: "list_room_tasks", args: { room_name: "x" }, id: "c1" }, thoughtSignature: "sig" }] },
    { role: "user", parts: [{ functionResponse: { name: "list_room_tasks", response: { error: "room_not_found" }, id: "c1" } }] },
  ]);
});

// --- resposta ---

test("lê chamadas de função e texto, e descarta raciocínio e partes desconhecidas", () => {
  const { content } = parseResponse({
    candidates: [{
      content: {
        role: "model",
        parts: [
          { text: "pensando...", thought: true },
          { functionCall: { name: "list_my_tasks", args: { range: "week" }, id: "abc" }, thoughtSignature: "sig" },
          { functionCall: { name: "list_sporadic_tasks" } },
          { inlineData: { mimeType: "image/png", data: "AAAA" } },
          { text: "olá" },
        ],
      },
    }],
  });
  assert.deepEqual(content, {
    role: "model",
    parts: [
      { kind: "functionCall", name: "list_my_tasks", args: { range: "week" }, id: "abc", thoughtSignature: "sig" },
      { kind: "functionCall", name: "list_sporadic_tasks", args: {} },
      { kind: "text", text: "olá" },
    ],
  });
});

test("chamadas mal formadas são descartadas em vez de interpretadas", () => {
  const parts = [
    { functionCall: { name: "", args: {} } },
    { functionCall: { name: "x".repeat(65), args: {} } },
    { functionCall: { name: 42, args: {} } },
    { functionCall: { name: "ok", args: "texto" } },
    { functionCall: { name: "ok", args: ["a"] } },
    { functionCall: "list_my_tasks" },
    null,
    "texto solto",
  ];
  assert.deepEqual(parseResponse({ candidates: [{ content: { parts } }] }).content.parts, []);
});

test("candidato sem partes vira resposta vazia (o modelo não escolheu nada)", () => {
  assert.deepEqual(parseResponse({ candidates: [{ content: { role: "model" }, finishReason: "STOP" }] }).content.parts, []);
});

async function failure(http: HttpFetch): Promise<GeminiRequestError> {
  try {
    await client(http).generate(request);
  } catch (error) {
    assert.ok(error instanceof GeminiRequestError, "esperava GeminiRequestError");
    return error;
  }
  return assert.fail("deveria lançar");
}

test("status de erro vira erro tipado com o status e sem o corpo da resposta", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const secret = "CORPO-COM-DADOS-DO-USUARIO";
    const error = await failure(fakeHttp(() => reply(`{"error":{"message":"${secret}"}}`, status)).http);
    assert.equal(error.code, "status");
    assert.equal(error.status, status);
    assert.ok(!error.message.includes(secret) && !String(error.stack).includes(secret));
  }
});

test("falha de rede e timeout são tipados, e o erro original (que pode citar a requisição) não é repassado", async () => {
  const network = await failure(async () => { throw new TypeError(`fetch failed: ${API_KEY}`); });
  assert.equal(network.code, "network");
  assert.ok(!network.message.includes(API_KEY) && !String(network.stack).includes(API_KEY));
  assert.equal(network.cause, undefined);
  const timeout = await failure(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); });
  assert.equal(timeout.code, "timeout");
  const aborted = await failure(async () => { throw new DOMException("aborted", "AbortError"); });
  assert.equal(aborted.code, "timeout");
});

test("falha ao ler o corpo também é erro de rede", async () => {
  const error = await failure(async () => ({ ok: true, status: 200, text: async () => { throw new Error("socket"); } }));
  assert.equal(error.code, "network");
});

test("corpo que não é JSON, não é objeto, é grande demais ou sem candidatos é resposta inválida", async () => {
  for (const body of ["<html>", "null", "[]", "42", "{}", JSON.stringify({ candidates: [] }), "x".repeat(256 * 1024 + 1)]) {
    assert.equal((await failure(fakeHttp(() => reply(body)).http)).code, "invalidResponse", body.slice(0, 20));
  }
  assert.equal((await failure(fakeHttp(() => reply(JSON.stringify({ candidates: [{ content: { parts: "x" } }] }))).http)).code, "invalidResponse");
});

test("bloqueio do prompt e candidato sem conteúdo são `blocked`", async () => {
  const promptBlocked = JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } });
  assert.equal((await failure(fakeHttp(() => reply(promptBlocked)).http)).code, "blocked");
  const noContent = JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] });
  assert.equal((await failure(fakeHttp(() => reply(noContent)).http)).code, "blocked");
});

test("o corpo da requisição não carrega a chave nem o `Authorization`", async () => {
  const { http, calls } = fakeHttp(() => reply(textBody("oi")));
  await client(http).generate(request);
  assert.deepEqual(Object.keys(calls[0]?.init.headers ?? {}).sort(), ["content-type", "x-goog-api-key"]);
});
