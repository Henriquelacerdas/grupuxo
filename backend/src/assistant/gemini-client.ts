import type { HttpFetch } from "../http.ts";

// Port do Gemini e implementação sobre a API REST `generateContent` com *function calling*. O modelo só interpreta
// a intenção: nada aqui grava dados ou calcula escala. Nenhuma mensagem de erro carrega o corpo da resposta, a chave
// da API ou o texto do usuário.

/** Parte de uma mensagem trocada com o modelo (subconjunto da API que o assistente usa). */
export type GeminiPart =
  | { readonly kind: "text"; readonly text: string }
  | {
    readonly kind: "functionCall";
    readonly name: string;
    /** Argumentos escolhidos pelo modelo: entrada não confiável, sempre validada por quem executa a ferramenta. */
    readonly args: Readonly<Record<string, unknown>>;
    /** Identificadores opacos que a API pede de volta no turno seguinte (modelos com raciocínio). */
    readonly id?: string;
    readonly thoughtSignature?: string;
  }
  | {
    readonly kind: "functionResponse";
    readonly name: string;
    readonly response: Readonly<Record<string, unknown>>;
    readonly id?: string;
  };

export interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiPart[];
}

export interface GeminiParameter {
  readonly type: "STRING";
  readonly description: string;
  readonly enum?: readonly string[];
}

export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  /** Sem `parameters`, a ferramenta não recebe argumento algum. */
  readonly parameters?: {
    readonly type: "OBJECT";
    readonly properties: Readonly<Record<string, GeminiParameter>>;
    readonly required: readonly string[];
  };
}

export interface GeminiRequest {
  readonly systemInstruction: string;
  readonly contents: readonly GeminiContent[];
  readonly functions: readonly GeminiFunctionDeclaration[];
}

export interface GeminiResponse {
  /** Resposta do modelo (`role: "model"`); partes de raciocínio e de tipos desconhecidos já foram descartadas. */
  readonly content: GeminiContent;
}

export interface GeminiClient {
  generate(request: GeminiRequest): Promise<GeminiResponse>;
}

/** Configuração ausente ou inválida (falha fechada, na composição, antes de qualquer chamada). */
export class GeminiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigurationError";
  }
}

export type GeminiRequestErrorCode =
  /** A requisição não chegou ao Gemini (DNS, conexão, TLS...). */
  | "network"
  | "timeout"
  /** O Gemini respondeu com status diferente de 2xx (inclui 429 e 5xx). */
  | "status"
  | "invalidResponse"
  /** O Gemini recusou ou não produziu conteúdo (filtros de segurança). */
  | "blocked";

const REQUEST_ERROR_MESSAGES: Readonly<Record<GeminiRequestErrorCode, string>> = {
  network: "Falha de rede ao chamar o Gemini",
  timeout: "O Gemini não respondeu a tempo",
  status: "O Gemini respondeu com erro",
  invalidResponse: "Resposta inválida do Gemini",
  blocked: "O Gemini não produziu resposta",
};

/** Falha ao falar com o Gemini. Mensagem fixa por código: nunca inclui o corpo da resposta nem dados do usuário. */
export class GeminiRequestError extends Error {
  readonly code: GeminiRequestErrorCode;
  /** Status HTTP quando `code` é `"status"`. */
  readonly status: number | null;

  constructor(code: GeminiRequestErrorCode, status: number | null = null) {
    super(REQUEST_ERROR_MESSAGES[code]);
    this.name = "GeminiRequestError";
    this.code = code;
    this.status = status;
  }
}

export interface HttpGeminiClientOptions {
  /** Chave da API (Secrets Manager, `GEMINI_API_KEY`). Vai só no cabeçalho `x-goog-api-key`. */
  readonly apiKey: string | undefined;
  /** Nome do modelo (`GEMINI_MODEL`). Sem valor, o cliente não é criado: não há modelo escondido. */
  readonly model: string | undefined;
  readonly http: HttpFetch;
  /** Padrão: 10 s. */
  readonly timeoutMs?: number;
  /** Teto de tokens de saída por chamada (o modelo só emite chamadas de ferramenta). Padrão: 512. */
  readonly maxOutputTokens?: number;
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";
// Entra na URL: só letras minúsculas, dígitos, ponto e hífen, começando por letra ou dígito (sem `/`, `:`, `?`, `#`, `%`, `..`).
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;
const MAX_RESPONSE_CHARS = 256 * 1024;
const MAX_FUNCTION_NAME_CHARS = 64;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

export class HttpGeminiClient implements GeminiClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly http: HttpFetch;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(options: HttpGeminiClientOptions) {
    const { apiKey, model } = options;
    if (model === undefined || model === "") throw new GeminiConfigurationError("GEMINI_MODEL não configurado");
    if (!MODEL_PATTERN.test(model)) throw new GeminiConfigurationError("GEMINI_MODEL inválido");
    if (apiKey === undefined || !API_KEY_PATTERN.test(apiKey)) throw new GeminiConfigurationError("GEMINI_API_KEY ausente ou inválida");
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxOutputTokens = options.maxOutputTokens ?? 512;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new GeminiConfigurationError("timeout do Gemini inválido");
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new GeminiConfigurationError("teto de tokens do Gemini inválido");
    this.url = `${ENDPOINT}${model}:generateContent`;
    this.apiKey = apiKey;
    this.http = options.http;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
  }

  async generate(request: GeminiRequest): Promise<GeminiResponse> {
    let text: string;
    try {
      const response = await this.http(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(this.requestBody(request)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new GeminiRequestError("status", response.status);
      text = await response.text();
    } catch (error) {
      if (error instanceof GeminiRequestError) throw error;
      // O erro original não é repassado: nada dele precisa chegar a log ou resposta.
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new GeminiRequestError(timedOut ? "timeout" : "network");
    }
    if (text.length > MAX_RESPONSE_CHARS) throw new GeminiRequestError("invalidResponse");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new GeminiRequestError("invalidResponse");
    }
    return parseResponse(body);
  }

  private requestBody(request: GeminiRequest): Readonly<Record<string, unknown>> {
    return {
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: request.contents.map((content) => ({ role: content.role, parts: content.parts.map(serializePart) })),
      tools: [{ functionDeclarations: request.functions }],
      // `ANY` obrigaria o modelo a chamar uma ferramenta mesmo para um "oi"; `AUTO` deixa-o não chamar nenhuma.
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { maxOutputTokens: this.maxOutputTokens, temperature: 0 },
    };
  }
}

function serializePart(part: GeminiPart): Readonly<Record<string, unknown>> {
  switch (part.kind) {
    case "text":
      return { text: part.text };
    case "functionCall":
      return {
        functionCall: { name: part.name, args: part.args, ...(part.id === undefined ? {} : { id: part.id }) },
        ...(part.thoughtSignature === undefined ? {} : { thoughtSignature: part.thoughtSignature }),
      };
    case "functionResponse":
      return {
        functionResponse: { name: part.name, response: part.response, ...(part.id === undefined ? {} : { id: part.id }) },
      };
  }
}

/** Lê o JSON de `generateContent` (desconhecido) sem confiar na forma: o que não for reconhecido é descartado. */
export function parseResponse(body: unknown): GeminiResponse {
  if (!isRecord(body)) throw new GeminiRequestError("invalidResponse");
  const candidates = field(body, "candidates");
  const first: unknown = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isRecord(first)) {
    // Sem candidato: o filtro de segurança do prompt é o caso conhecido; qualquer outra forma é resposta inválida.
    const feedback = field(body, "promptFeedback");
    throw new GeminiRequestError(isRecord(feedback) && field(feedback, "blockReason") !== undefined ? "blocked" : "invalidResponse");
  }
  const content = field(first, "content");
  if (!isRecord(content)) throw new GeminiRequestError("blocked");
  const rawParts = field(content, "parts");
  if (rawParts === undefined) return { content: { role: "model", parts: [] } };
  if (!Array.isArray(rawParts)) throw new GeminiRequestError("invalidResponse");
  const parts: GeminiPart[] = [];
  const list: readonly unknown[] = rawParts;
  for (const raw of list) {
    const part = parsePart(raw);
    if (part !== null) parts.push(part);
  }
  return { content: { role: "model", parts } };
}

function parsePart(raw: unknown): GeminiPart | null {
  if (!isRecord(raw)) return null;
  const call = field(raw, "functionCall");
  if (call !== undefined) {
    if (!isRecord(call)) return null;
    const name = field(call, "name");
    const args = field(call, "args");
    const id = field(call, "id");
    const signature = field(raw, "thoughtSignature");
    if (typeof name !== "string" || name === "" || name.length > MAX_FUNCTION_NAME_CHARS) return null;
    if (args !== undefined && !isRecord(args)) return null;
    return {
      kind: "functionCall",
      name,
      args: args === undefined ? {} : Object.fromEntries(Object.entries(args)),
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof signature === "string" ? { thoughtSignature: signature } : {}),
    };
  }
  const text = field(raw, "text");
  // Partes de raciocínio (`thought: true`) não são resposta.
  if (typeof text === "string" && field(raw, "thought") !== true) return { kind: "text", text };
  return null;
}
