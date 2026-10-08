// Conversão dos eventos da AWS (Lambda Function URL, payload 2.0, e SQS) em tipos nossos. O evento chega como `unknown`
// e é estreitado à mão: o que não tem a forma esperada vira `null` (o handler decide o que responder). Nenhum
// conteúdo de mensagem, cabeçalho ou token é registrado em log.

export type Fields = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lê uma chave própria (nunca do protótipo). */
export function field(record: Fields, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** Requisição HTTP já desacoplada da AWS. Os nomes dos cabeçalhos vêm em minúsculo (formato 2.0). */
export interface HttpApiRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly queryParameters: Readonly<Record<string, string>>;
  /** Corpo **bruto**, já decodificado do base64 quando for o caso: a assinatura do webhook cobre estes bytes. */
  readonly body: Uint8Array;
}

/** Resposta no formato que a Function URL (payload 2.0) entende. */
export interface HttpApiResult {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: string;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") result[key] = entry;
  return result;
}

function parseQuery(rawQueryString: unknown, fallback: unknown): Record<string, string> {
  // `rawQueryString` é decodificado aqui (URLSearchParams); a primeira ocorrência de cada chave vale.
  if (typeof rawQueryString !== "string") return stringRecord(fallback);
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawQueryString)) if (!Object.hasOwn(result, key)) result[key] = value;
  return result;
}

/** `null` se o evento não for uma requisição da Function URL (payload 2.0) bem formada. */
export function parseHttpApiEvent(event: unknown): HttpApiRequest | null {
  if (!isRecord(event)) return null;
  const context = field(event, "requestContext");
  const http = isRecord(context) ? field(context, "http") : undefined;
  const method = isRecord(http) ? field(http, "method") : undefined;
  const path = field(event, "rawPath");
  if (typeof method !== "string" || method === "" || typeof path !== "string") return null;

  const rawBody = field(event, "body");
  const base64 = field(event, "isBase64Encoded");
  if (rawBody !== undefined && typeof rawBody !== "string") return null;
  if (base64 !== undefined && typeof base64 !== "boolean") return null;
  let body: Uint8Array;
  if (rawBody === undefined) {
    body = new Uint8Array();
  } else if (base64 === true) {
    if (!BASE64_PATTERN.test(rawBody)) return null;
    body = new Uint8Array(Buffer.from(rawBody, "base64"));
  } else {
    body = new TextEncoder().encode(rawBody);
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(stringRecord(field(event, "headers")))) headers[name.toLowerCase()] = value;
  return {
    method, path, headers, body,
    queryParameters: parseQuery(field(event, "rawQueryString"), field(event, "queryStringParameters")),
  };
}

export interface SqsRecord {
  readonly messageId: string;
  readonly body: string;
  /** `MessageGroupId` da fila FIFO (o telefone); `null` em fila padrão. */
  readonly messageGroupId: string | null;
}

/** `null` se o evento não for um lote do SQS bem formado. */
export function parseSqsEvent(event: unknown): readonly SqsRecord[] | null {
  if (!isRecord(event)) return null;
  const records = field(event, "Records");
  if (!Array.isArray(records)) return null;
  const list: readonly unknown[] = records;
  const result: SqsRecord[] = [];
  for (const record of list) {
    if (!isRecord(record)) return null;
    const messageId = field(record, "messageId");
    const body = field(record, "body");
    if (typeof messageId !== "string" || messageId === "" || typeof body !== "string") return null;
    const attributes = field(record, "attributes");
    const group = isRecord(attributes) ? field(attributes, "MessageGroupId") : undefined;
    result.push({ messageId, body, messageGroupId: typeof group === "string" && group !== "" ? group : null });
  }
  return result;
}
