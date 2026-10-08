import type { HttpFetch, HttpResponse } from "../../src/http.ts";

// Infraestrutura dos scripts descartáveis de validação contra as APIs reais (Graph e Gemini). Garantias:
//  - nada roda sem item explícito (`parseCli`), e `--dry-run` nunca toca a rede;
//  - toda saída passa por `out`, que apaga segredos registrados e qualquer sequência longa de dígitos (telefones);
//  - o que se imprime de corpos de resposta é só a *forma* (`shapeOf`: chaves e tipos, nunca strings) ou campos de
//    vocabulário fechado (`safeScalar`: códigos de erro, `finishReason`...). Nunca `error.message`, `wa_id`, texto;
//  - nada é gravado em arquivo.

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Saída segura

const secrets = new Set<string>();
let sink: (line: string) => void = (line) => console.log(line);

/** Segredo a nunca imprimir (token, chave, `PHONE_NUMBER_ID`, telefone). Valores curtos demais são ignorados. */
export function registerSecret(value: string): void {
  if (value.length >= 3) secrets.add(value);
}

export function clearSecrets(): void {
  secrets.clear();
}

export function scrub(line: string): string {
  let result = line;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) result = result.replaceAll(secret, "[segredo]");
  return result.replace(/\+?\d{7,}/g, "[dígitos]");
}

export function out(line: string): void {
  sink(scrub(line));
}

/** Troca o destino da saída (testes). Devolve o anterior. */
export function setOutput(next: (line: string) => void): (line: string) => void {
  const previous = sink;
  sink = next;
  return previous;
}

/** Só o nome do erro: a mensagem de um erro de rede ou de parse pode conter pedaços da URL ou do corpo. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "erro desconhecido";
}

// ---------------------------------------------------------------------------------------------------------------
// JSON desconhecido

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function field(record: unknown, name: string): unknown {
  return isRecord(record) && Object.hasOwn(record, name) ? record[name] : undefined;
}

/** Caminho por chaves (string) e índices (number) sem confiar na forma. */
export function at(value: unknown, ...path: readonly (string | number)[]): unknown {
  let current: unknown = value;
  for (const step of path) {
    if (typeof step === "number") {
      if (!Array.isArray(current)) return undefined;
      const list: readonly unknown[] = current;
      current = list[step];
    } else {
      current = field(current, step);
    }
  }
  return current;
}

export function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** Forma do JSON: chaves e tipos. Números e booleanos aparecem; strings nunca (viram `string`). */
export function shapeOf(value: unknown, depth = 0): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
    case "boolean":
      return String(value);
    case "object":
      break;
    default:
      return typeof value;
  }
  if (depth >= 8) return "…";
  if (Array.isArray(value)) {
    const list: readonly unknown[] = value;
    return list.length === 0 ? "[]" : `[${shapeOf(list[0], depth + 1)}]x${list.length}`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, 40).map(([key, entry]) => `${key}:${shapeOf(entry, depth + 1)}`);
    return `{${entries.join(",")}}`;
  }
  return typeof value;
}

const SAFE_VOCABULARY = /^[A-Za-z0-9_.@/-]{1,64}$/;

/**
 * Valor de um campo de **vocabulário fechado** (código de erro, `finishReason`, nome de ferramenta). Só para campos
 * assim: uma string que não pareça um identificador vira `<string>`; telefones ainda caem no `scrub`.
 */
export function safeScalar(value: unknown): string {
  if (typeof value === "string") return SAFE_VOCABULARY.test(value) ? value : "<string>";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "<ausente>";
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP

/** Resposta que também expõe cabeçalhos (os clientes do projeto só enxergam `HttpResponse`). */
export interface RichResponse extends HttpResponse {
  headerValue(name: string): string | null;
}

function isRich(response: HttpResponse): response is RichResponse {
  return "headerValue" in response && typeof response.headerValue === "function";
}

/** `HttpFetch` real, sobre o `fetch` do Node. */
export const fetchHttp: HttpFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    ...(init.headers === undefined ? {} : { headers: { ...init.headers } }),
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
  const rich: RichResponse = {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    headerValue: (name) => response.headers.get(name),
  };
  return rich;
};

export interface Recorded {
  readonly status: number;
  /** Corpo bruto, só em memória: nunca impresso, só inspecionado por `shapeOf`/`safeScalar`/`field`. */
  readonly body: string;
  readonly ms: number;
  readonly apiVersion: string | null;
}

export interface Recording {
  /** Vai para o cliente real: ele continua vendo só `ok`, `status` e `text()`. */
  readonly http: HttpFetch;
  /** Última resposta recebida desde o último `reset` (`null` se a requisição nem saiu ou falhou na rede). */
  last(): Recorded | null;
  reset(): void;
  calls(): number;
}

export function recording(base: HttpFetch): Recording {
  let latest: Recorded | null = null;
  let count = 0;
  const http: HttpFetch = async (url, init) => {
    count += 1;
    latest = null;
    const started = performance.now();
    const response = await base(url, init);
    const body = await response.text();
    latest = {
      status: response.status,
      body,
      ms: Math.round(performance.now() - started),
      apiVersion: isRich(response) ? response.headerValue("facebook-api-version") : null,
    };
    return { ok: response.ok, status: response.status, text: async () => body };
  };
  return { http, last: () => latest, reset: () => { latest = null; }, calls: () => count };
}

/** POST/GET cru (bypass deliberado do cliente do projeto) sobre o mesmo `HttpFetch`; nunca lança. */
export async function rawRequest(
  rec: Recording,
  method: "GET" | "POST",
  url: string,
  headers: Readonly<Record<string, string>>,
  body?: unknown,
): Promise<Recorded | null> {
  rec.reset();
  try {
    await rec.http(url, {
      method,
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    out(`    requisição crua falhou antes da resposta (${errorName(error)})`);
  }
  return rec.last();
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP falso para --dry-run (nenhuma rede)

function jsonResponse(status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): RichResponse {
  const body = JSON.stringify(value);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headerValue: (name) => headers[name.toLowerCase()] ?? null,
  };
}

const DRY_RUN_UNKNOWN_PHONE_NUMBER_ID = "100000000000001";

/** Imita Graph e Gemini com respostas fixas, só para exercitar os scripts. Não valida nada do mundo real. */
export function dryRunHttp(): HttpFetch {
  return async (url, init) => {
    const target = new URL(url);
    const parsedBody = init.body === undefined ? undefined : parseJson(init.body);
    if (target.hostname === "graph.facebook.com") return dryRunGraph(target, init.method, init.headers ?? {}, parsedBody);
    if (target.hostname === "generativelanguage.googleapis.com") return dryRunGemini(target, init.method, init.headers ?? {}, parsedBody);
    return jsonResponse(404, { error: "dry-run: host desconhecido" });
  };
}

function dryRunGraph(
  target: URL, method: string, headers: Readonly<Record<string, string>>, body: unknown,
): RichResponse {
  const apiHeaders = { "facebook-api-version": target.pathname.split("/")[1] ?? "" };
  const oauth = (code: number, subcode?: number): RichResponse => jsonResponse(
    code === 190 ? 401 : 400,
    { error: { message: "dry-run", type: "OAuthException", code, ...(subcode === undefined ? {} : { error_subcode: subcode }), fbtrace_id: "dry-run" } },
    apiHeaders,
  );
  if (headers["authorization"] === "Bearer invalid") return oauth(190);
  if (method === "GET") return jsonResponse(200, { id: "dry-run" }, apiHeaders);
  if (target.pathname.split("/")[2] === DRY_RUN_UNKNOWN_PHONE_NUMBER_ID) return oauth(100, 33);
  const to = field(body, "to");
  const text = field(field(body, "text"), "body");
  if (typeof to !== "string" || !/^\+?[1-9][0-9]{7,14}$/.test(to)) return oauth(100);
  if (typeof text !== "string" || [...text].length > 4096) return oauth(100);
  const digits = to.replace(/\D/g, "");
  return jsonResponse(
    200,
    { messaging_product: "whatsapp", contacts: [{ input: to, wa_id: digits }], messages: [{ id: "wamid.dry-run" }] },
    apiHeaders,
  );
}

function dryRunGemini(
  target: URL, method: string, headers: Readonly<Record<string, string>>, body: unknown,
): RichResponse {
  const failure = (status: number, name: string, reason?: string): RichResponse => jsonResponse(status, {
    error: { code: status, message: "dry-run", status: name, ...(reason === undefined ? {} : { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] }) },
  });
  if (headers["x-goog-api-key"] === "invalid") return failure(400, "INVALID_ARGUMENT", "API_KEY_INVALID");
  if (target.pathname.includes("modelo-inexistente")) return failure(404, "NOT_FOUND");
  if (method === "GET") {
    return jsonResponse(200, {
      name: "models/dry-run", version: "dry-run", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1000, outputTokenLimit: 100,
    });
  }
  const contents = field(body, "contents");
  if (!Array.isArray(contents) || contents.length === 0) return failure(400, "INVALID_ARGUMENT");
  const usage = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
  const hasFunctionResponse = JSON.stringify(contents).includes("functionResponse");
  const parts = hasFunctionResponse
    ? [{ text: "dry-run" }]
    : [{ functionCall: { name: "list_my_tasks", args: { range: "week" }, id: "dry-run" }, thoughtSignature: "dry-run" }];
  return jsonResponse(200, { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: usage, modelVersion: "dry-run" });
}

// ---------------------------------------------------------------------------------------------------------------
// Linha de comando e ambiente

export interface CliOptions {
  readonly items: readonly string[];
  readonly dryRun: boolean;
  readonly list: boolean;
}

/** Exige item(ns) explícito(s): não existe "rodar tudo", porque cada item é autorizado separadamente. */
export function parseCli(argv: readonly string[], known: Readonly<Record<string, string>>): CliOptions {
  let dryRun = false;
  let list = false;
  const items: string[] = [];
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--list") list = true;
    else if (Object.hasOwn(known, arg)) {
      if (!items.includes(arg)) items.push(arg);
    } else throw new UsageError("Argumento desconhecido. Use --list para ver os itens.");
  }
  if (!list && items.length === 0) throw new UsageError("Informe ao menos um item (cada item exige autorização). Use --list para ver os itens.");
  return { items, dryRun, list };
}

/** Lê uma variável de ambiente; no `--dry-run` usa o valor de mentira. O erro cita só o nome da variável. */
export function readEnv(name: string, dryRun: boolean, dryValue: string, options: { readonly secret: boolean }): string {
  const raw = dryRun ? dryValue : process.env[name];
  if (raw === undefined || raw === "") throw new UsageError(`Variável de ambiente ausente: ${name}`);
  if (options.secret) registerSecret(raw);
  return raw;
}

export function readOptionalEnv(name: string, dryRun: boolean, dryValue: string | undefined, options: { readonly secret: boolean }): string | undefined {
  const raw = dryRun ? dryValue : process.env[name];
  if (raw === undefined || raw === "") return undefined;
  if (options.secret) registerSecret(raw);
  return raw;
}

export type Handlers = Readonly<Record<string, () => Promise<void>>>;

/** Executa os itens pedidos, em ordem. Devolve o código de saída; nunca imprime mensagens de erro de terceiros. */
export async function runMain(
  argv: readonly string[],
  known: Readonly<Record<string, string>>,
  build: (dryRun: boolean) => Handlers,
): Promise<number> {
  try {
    const options = parseCli(argv, known);
    if (options.list) {
      for (const [item, description] of Object.entries(known)) out(`${item}  ${description}`);
      return 0;
    }
    out(options.dryRun ? "Modo --dry-run: nenhuma chamada de rede." : "ATENÇÃO: chamadas reais à rede, só para os itens autorizados.");
    const handlers = build(options.dryRun);
    for (const item of options.items) {
      out(`\n== ${item} ==`);
      const handler = handlers[item];
      if (handler === undefined) throw new UsageError(`Item sem implementação: ${item}`);
      await handler();
    }
    return 0;
  } catch (error) {
    out(error instanceof UsageError ? error.message : `Falha inesperada (${errorName(error)})`);
    return 1;
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return value ?? 0;
}
