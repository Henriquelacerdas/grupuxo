import type { Instant } from "../../domain/dates.ts";
import type { IncomingMessage } from "../incoming-message.ts";

/**
 * Subconjunto do payload do webhook da WhatsApp Cloud API que o backend usa. Campos não declarados
 * (`statuses`, `contacts`, `metadata`...) são ignorados. A decodificação é tão rígida quanto o `Decodable` do
 * Swift: campo obrigatório ausente ou com tipo errado invalida o payload inteiro (o webhook responde 400).
 */
export interface WebhookPayload {
  readonly object: string | null;
  readonly entry: readonly Entry[] | null;
}

interface Entry {
  readonly changes: readonly Change[] | null;
}

interface Change {
  readonly field: string | null;
  readonly value: Value | null;
}

interface Value {
  readonly messages: readonly Message[] | null;
}

interface Message {
  readonly from: string;
  readonly id: string;
  readonly timestamp: string | null;
  readonly type: string;
  readonly text: { readonly body: string } | null;
}

export class PayloadError extends Error {
  constructor(path: string) {
    super(`payload inválido em ${path}`);
    this.name = "PayloadError";
  }
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PayloadError(path);
  return Object.fromEntries(Object.entries(value));
}

function optional<T>(source: Record<string, unknown>, key: string, path: string, decode: (value: unknown, path: string) => T): T | null {
  const value = source[key];
  return value === undefined || value === null ? null : decode(value, `${path}.${key}`);
}

function required<T>(source: Record<string, unknown>, key: string, path: string, decode: (value: unknown, path: string) => T): T {
  const value = source[key];
  if (value === undefined || value === null) throw new PayloadError(`${path}.${key}`);
  return decode(value, `${path}.${key}`);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new PayloadError(path);
  return value;
}

function asArray<T>(decode: (value: unknown, path: string) => T): (value: unknown, path: string) => T[] {
  return (value, path) => {
    if (!Array.isArray(value)) throw new PayloadError(path);
    return value.map((item: unknown, index) => decode(item, `${path}[${index}]`));
  };
}

function decodeMessage(value: unknown, path: string): Message {
  const message = asObject(value, path);
  return {
    from: required(message, "from", path, asString),
    id: required(message, "id", path, asString),
    timestamp: optional(message, "timestamp", path, asString),
    type: required(message, "type", path, asString),
    text: optional(message, "text", path, (raw, p) => ({ body: required(asObject(raw, p), "body", p, asString) })),
  };
}

function decodeValue(value: unknown, path: string): Value {
  return { messages: optional(asObject(value, path), "messages", path, asArray(decodeMessage)) };
}

function decodeChange(value: unknown, path: string): Change {
  const change = asObject(value, path);
  return { field: optional(change, "field", path, asString), value: optional(change, "value", path, decodeValue) };
}

function decodeEntry(value: unknown, path: string): Entry {
  return { changes: optional(asObject(value, path), "changes", path, asArray(decodeChange)) };
}

export function decodeWebhookPayload(value: unknown): WebhookPayload {
  const payload = asObject(value, "$");
  return {
    object: optional(payload, "object", "$", asString),
    entry: optional(payload, "entry", "$", asArray(decodeEntry)),
  };
}

/** A Meta envia o número só com dígitos (`5511999998888`); o backend guarda em E.164 (`+5511999998888`). */
export function e164FromWhatsAppID(id: string): string | null {
  const digits = id.replace(/[^0-9]/g, "");
  return digits === "" ? null : `+${digits}`;
}

/**
 * Mensagens de texto do payload, na ordem de chegada. Outros tipos (imagem, áudio, reação...) e os eventos de
 * `statuses` (entregue, lido) são descartados na v1. Sem `timestamp` válido, vale `fallbackDate`.
 */
export function incomingTextMessages(payload: WebhookPayload, fallbackDate: Instant): IncomingMessage[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const result: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== null && change.field !== "messages") continue;
      for (const message of change.value?.messages ?? []) {
        const body = message.text?.body;
        const phone = e164FromWhatsAppID(message.from);
        if (message.type !== "text" || body === undefined || body === "" || phone === null) continue;
        result.push({ wamid: message.id, phoneE164: phone, text: body, receivedAt: receivedAt(message.timestamp, fallbackDate) });
      }
    }
  }
  return result;
}

function receivedAt(timestamp: string | null, fallback: Instant): Instant {
  if (timestamp === null || !/^\d+(\.\d+)?$/.test(timestamp)) return fallback;
  const milliseconds = Number(timestamp) * 1000;
  return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? milliseconds : fallback;
}
