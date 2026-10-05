import type { WebhookHandler } from "../whatsapp/webhook/webhook-handler.ts";
import { parseHttpApiEvent, type HttpApiResult } from "./events.ts";

/**
 * Lambda `whatsapp-webhook`: converte o evento do API Gateway em `WebhookRequest` e devolve a resposta do
 * `WebhookHandler`. Sem regra aqui. Evento que não é uma requisição HTTP bem formada responde 400.
 */
export function createWebhookHandler(webhook: Pick<WebhookHandler, "handle">): (event: unknown) => Promise<HttpApiResult> {
  return async (event) => {
    const request = parseHttpApiEvent(event);
    if (request === null) return { statusCode: 400, body: "" };
    const response = await webhook.handle({
      method: request.method,
      queryParameters: request.queryParameters,
      headers: request.headers,
      body: request.body,
    });
    // O `challenge` da verificação é texto puro.
    return { statusCode: response.statusCode, headers: { "content-type": "text/plain; charset=utf-8" }, body: response.body };
  };
}
