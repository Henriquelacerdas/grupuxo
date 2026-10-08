import { createHmac } from "node:crypto";
import { InMemoryRateCounter } from "../../src/adapters/in-memory/rate-counter.ts";
import { MessageRateLimiter } from "../../src/whatsapp/rate-limit.ts";
import type { WebhookRequest } from "../../src/whatsapp/webhook/webhook-handler.ts";

export const APP_SECRET = "segredo-do-app";
export const VERIFY_TOKEN = "senha-do-webhook";

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

export function sign(body: Uint8Array, secret: string = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function payload(
  options: { messages?: string; statuses?: string; object?: string; field?: string } = {},
): Uint8Array {
  const { messages, statuses, object = "whatsapp_business_account", field = "messages" } = options;
  let value = `"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"123"}`;
  if (messages !== undefined) value += `,"contacts":[{"profile":{"name":"Ana"},"wa_id":"5511999998888"}],"messages":${messages}`;
  if (statuses !== undefined) value += `,"statuses":${statuses}`;
  return bytes(`{"object":"${object}","entry":[{"id":"456","changes":[{"field":"${field}","value":{${value}}}]}]}`);
}

export function textEvent(
  options: { wamid?: string; from?: string; body?: string; timestamp?: string } = {},
): Uint8Array {
  const { wamid = "wamid.A", from = "5511999998888", body = "quais são minhas tarefas?", timestamp = "1700000000" } = options;
  return payload({ messages: `[{"from":"${from}","id":"${wamid}","timestamp":"${timestamp}","type":"text","text":{"body":"${body}"}}]` });
}

export function request(options: { method?: string; body: Uint8Array; signature: string | null }): WebhookRequest {
  const headers: Record<string, string> = {};
  if (options.signature !== null) headers["x-hub-signature-256"] = options.signature;
  return { method: options.method ?? "POST", headers, body: options.body };
}

/** Limite folgado para os testes que não tratam de taxa: nunca barra. */
export function openRateLimiter(): MessageRateLimiter {
  return new MessageRateLimiter({ counter: new InMemoryRateCounter(), limit: 1_000_000, windowSeconds: 60 });
}
