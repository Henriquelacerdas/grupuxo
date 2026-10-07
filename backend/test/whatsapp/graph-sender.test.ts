import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpFetch, HttpRequestInit, HttpResponse } from "../../src/http.ts";
import {
  GraphConfigurationError, GraphSendError, GraphWhatsAppSender, MAX_MESSAGE_CHARS, truncateMessage,
  type GraphWhatsAppSenderOptions,
} from "../../src/whatsapp/graph-sender.ts";

const TOKEN = "EAAJB-token-secreto-de-teste";
const PHONE_NUMBER_ID = "106540352242922";
const VERSION = "v25.0";
const TO = "+5511999998888";

interface Recorded {
  readonly url: string;
  readonly init: HttpRequestInit;
}

const reply = (status = 200, body = '{"messages":[{"id":"wamid.SECRETO"}]}'): HttpResponse => ({
  ok: status >= 200 && status < 300, status, text: async () => body,
});

function fakeHttp(respond: () => HttpResponse | Promise<HttpResponse> = () => reply()): { http: HttpFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { http, calls };
}

function sender(http: HttpFetch, overrides: Partial<GraphWhatsAppSenderOptions> = {}): GraphWhatsAppSender {
  return new GraphWhatsAppSender({ accessToken: TOKEN, phoneNumberID: PHONE_NUMBER_ID, apiVersion: VERSION, http, ...overrides });
}

function bodyOf(call: Recorded | undefined): Record<string, unknown> {
  assert.ok(call !== undefined && call.init.body !== undefined);
  const parsed: unknown = JSON.parse(call.init.body);
  assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
  return Object.fromEntries(Object.entries(parsed));
}

const sendError = (code: GraphSendError["code"], status: number | null = null) => (error: unknown) =>
  error instanceof GraphSendError && error.code === code && error.status === status;

// --- configuração: falha fechada ---

test("sem versão da Graph API o sender não é criado: não existe versão escondida", () => {
  const { http } = fakeHttp();
  for (const apiVersion of [undefined, ""]) assert.throws(() => sender(http, { apiVersion }), GraphConfigurationError);
});

test("a versão entra na URL, então só aceita o formato vNN.N", () => {
  const { http } = fakeHttp();
  for (const apiVersion of ["25.0", "v25", "v25.0/x", "v25.0?a=b", "../v25.0", "V25.0", "v25.0 ", "v1234.0", "v25.123", "v25.0\n", "latest"]) {
    assert.throws(() => sender(http, { apiVersion }), GraphConfigurationError, apiVersion);
  }
  for (const apiVersion of ["v25.0", "v9.0", "v100.12"]) assert.doesNotThrow(() => sender(http, { apiVersion }), apiVersion);
});

test("o PHONE_NUMBER_ID entra na URL, então só aceita dígitos", () => {
  const { http } = fakeHttp();
  for (const phoneNumberID of [undefined, "", "abc", "123/456", "123?x=1", "../1", "12 3", "123\n", "-1", "1".repeat(21)]) {
    assert.throws(() => sender(http, { phoneNumberID }), GraphConfigurationError, String(phoneNumberID));
  }
});

test("token ausente ou com espaço/quebra de linha é erro de configuração, sem repetir o token", () => {
  const { http } = fakeHttp();
  for (const accessToken of [undefined, "", "tem espaço", "quebra\nde linha", "x".repeat(513)]) {
    assert.throws(() => sender(http, { accessToken }), GraphConfigurationError);
  }
  try {
    sender(http, { accessToken: "token com espaço" });
    assert.fail("deveria lançar");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("token com espaço"));
  }
});

test("o timeout precisa ser inteiro positivo", () => {
  const { http } = fakeHttp();
  for (const timeoutMs of [0, -1, 1.5, Number.NaN]) assert.throws(() => sender(http, { timeoutMs }), GraphConfigurationError);
});

// --- requisição ---

test("envia o POST com URL, cabeçalhos e corpo exatos", async () => {
  const { http, calls } = fakeHttp();
  await sender(http).send("Suas tarefas: Lavar a louça", TO);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { "content-type": "application/json", authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(bodyOf(call), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: TO,
    type: "text",
    text: { body: "Suas tarefas: Lavar a louça" },
  });
  assert.ok(call.init.signal instanceof AbortSignal);
});

test("o telefone vai em E.164 com +, sem normalizar de novo", async () => {
  const { http, calls } = fakeHttp();
  await sender(http).send("oi", "+5521988887777");
  assert.equal(bodyOf(calls[0])["to"], "+5521988887777");
});

test("o token vai só no cabeçalho: nunca na URL nem no corpo", async () => {
  const { http, calls } = fakeHttp();
  await sender(http).send("oi", TO);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.ok(!call.url.includes(TOKEN));
  assert.ok(!(call.init.body ?? "").includes(TOKEN));
});

test("a resposta de sucesso não é lida", async () => {
  let read = false;
  const { http } = fakeHttp(() => ({ ok: true, status: 200, text: async () => { read = true; return ""; } }));
  await sender(http).send("oi", TO);
  assert.equal(read, false);
});

test("usa o timeout configurado (padrão de 10 s)", async () => {
  const seen: AbortSignal[] = [];
  const http: HttpFetch = async (_url, init) => {
    if (init.signal !== undefined) seen.push(init.signal);
    return reply();
  };
  await sender(http).send("oi", TO);
  await sender(http, { timeoutMs: 5 }).send("oi", TO);
  assert.equal(seen.length, 2);
});

// --- corte de 4096 caracteres ---

test("texto com até 4096 caracteres vai inteiro", async () => {
  const { http, calls } = fakeHttp();
  const text = "a".repeat(MAX_MESSAGE_CHARS);
  await sender(http).send(text, TO);
  assert.deepEqual(bodyOf(calls[0])["text"], { body: text });
});

test("texto maior é cortado em 4096 caracteres, com reticências", async () => {
  const { http, calls } = fakeHttp();
  await sender(http).send("a".repeat(MAX_MESSAGE_CHARS + 500), TO);
  assert.deepEqual(bodyOf(calls[0])["text"], { body: `${"a".repeat(MAX_MESSAGE_CHARS - 1)}…` });
});

test("o corte nunca parte um emoji no meio (par substituto) e conta pontos de código", () => {
  const emoji = "😀";
  const cut = truncateMessage(emoji.repeat(MAX_MESSAGE_CHARS + 1));
  assert.equal([...cut].length, MAX_MESSAGE_CHARS);
  assert.ok(cut.endsWith(`${emoji}…`));
  // Nenhum par substituto solto.
  assert.equal(cut, Buffer.from(cut, "utf8").toString("utf8"));
  // 4096 emojis (8192 unidades UTF-16) cabem: o limite conta caracteres, não unidades UTF-16.
  assert.equal(truncateMessage(emoji.repeat(MAX_MESSAGE_CHARS)), emoji.repeat(MAX_MESSAGE_CHARS));
});

// --- validação da entrada ---

test("destinatário fora de E.164 com + é recusado antes de qualquer chamada", async () => {
  const { http, calls } = fakeHttp();
  for (const phone of ["", "5511999998888", "+0511999998888", "+55 11 99999-8888", "+55(11)999998888", "+123", "+1234567890123456", "+55119999\n", "abc", "+5511999998888/x"]) {
    await assert.rejects(sender(http).send("oi", phone), sendError("invalidRecipient"), phone);
  }
  assert.equal(calls.length, 0);
});

test("texto vazio é recusado antes de qualquer chamada", async () => {
  const { http, calls } = fakeHttp();
  await assert.rejects(sender(http).send("", TO), sendError("emptyMessage"));
  assert.equal(calls.length, 0);
});

// --- falhas propagam, sem vazar nada ---

test("status diferente de 2xx vira erro com o status e sem o corpo da resposta", async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    const { http } = fakeHttp(() => reply(status, '{"error":{"message":"corpo secreto da Meta","error_data":{"details":"+5511999998888"}}}'));
    await assert.rejects(sender(http).send("oi", TO), sendError("status", status));
  }
});

test("erro de rede vira erro tipado, sem repassar a causa", async () => {
  const http: HttpFetch = async () => {
    throw new Error(`getaddrinfo falhou para ${TOKEN} ${TO}`);
  };
  await assert.rejects(sender(http).send("texto privado", TO), sendError("network"));
});

test("timeout (TimeoutError ou AbortError) vira erro de timeout", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const http: HttpFetch = async () => {
      throw new DOMException("tempo esgotado", name);
    };
    await assert.rejects(sender(http).send("oi", TO), sendError("timeout"));
  }
});

test("a requisição é abortada de verdade quando o timeout estoura", async () => {
  const http: HttpFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  await assert.rejects(sender(http, { timeoutMs: 5 }).send("oi", TO), sendError("timeout"));
});

test("nenhum erro revela o token, o texto, o telefone nem o corpo da resposta", async () => {
  const secrets = [TOKEN, "texto privado do morador", TO, "corpo secreto da Meta", PHONE_NUMBER_ID];
  const failures: HttpFetch[] = [
    async () => reply(400, "corpo secreto da Meta"),
    async () => {
      throw new Error(`falha com ${secrets.join(" ")}`);
    },
    async () => {
      throw new DOMException(`falha com ${secrets.join(" ")}`, "TimeoutError");
    },
  ];
  for (const http of failures) {
    try {
      await sender(http).send("texto privado do morador", TO);
      assert.fail("deveria lançar");
    } catch (error) {
      assert.ok(error instanceof GraphSendError);
      const shown = `${error.message} ${String(error)} ${JSON.stringify(error)} ${error.stack ?? ""} ${error.status ?? ""}`;
      for (const secret of secrets.slice(0, 4)) assert.ok(!shown.includes(secret), `vazou: ${secret}`);
      assert.equal(error.cause, undefined);
    }
  }
});
