import type { Instant } from "../../domain/dates.ts";
import type { MessageQueue } from "../ports.ts";
import { constantTimeEquals, SignatureVerifier } from "./signature-verifier.ts";
import { decodeWebhookPayload, incomingTextMessages } from "./webhook-payload.ts";

/** Requisição HTTP já desacoplada da AWS: a Lambda `whatsapp-webhook` só converte o evento nisto. */
export interface WebhookRequest {
  readonly method: string;
  readonly queryParameters?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  /** Corpo **bruto**: a assinatura é calculada sobre os bytes exatos recebidos. */
  readonly body?: Uint8Array;
}

export interface WebhookResponse {
  readonly statusCode: number;
  readonly body: string;
}

export interface WebhookConfig {
  /** `VERIFY_TOKEN`: "senha" da verificação (GET). */
  readonly verifyToken: string;
  /** `WHATSAPP_APP_SECRET`: valida a assinatura dos eventos (POST). */
  readonly appSecret: string;
}

function header(request: WebhookRequest, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * Lógica da Lambda `whatsapp-webhook`: responde ao *challenge*, valida a assinatura e enfileira. Não chama
 * LLM nem domínio, para responder 200 em milissegundos. Nunca registra o conteúdo das mensagens.
 */
export class WebhookHandler {
  private readonly config: WebhookConfig;
  private readonly verifier: SignatureVerifier;
  private readonly queue: MessageQueue;
  private readonly now: () => Instant;

  constructor(config: WebhookConfig, queue: MessageQueue, now: () => Instant) {
    this.config = config;
    this.verifier = new SignatureVerifier(config.appSecret);
    this.queue = queue;
    this.now = now;
  }

  async handle(request: WebhookRequest): Promise<WebhookResponse> {
    switch (request.method.toUpperCase()) {
      case "GET": return this.verify(request);
      case "POST": return this.receive(request);
      default: return { statusCode: 405, body: "" };
    }
  }

  private verify(request: WebhookRequest): WebhookResponse {
    const parameters = request.queryParameters ?? {};
    const token = parameters["hub.verify_token"];
    const challenge = parameters["hub.challenge"];
    if (
      parameters["hub.mode"] !== "subscribe" || this.config.verifyToken === "" || token === undefined ||
      !constantTimeEquals(token, this.config.verifyToken) || challenge === undefined
    ) {
      return { statusCode: 403, body: "" };
    }
    return { statusCode: 200, body: challenge };
  }

  private async receive(request: WebhookRequest): Promise<WebhookResponse> {
    const body = request.body ?? new Uint8Array();
    if (!this.verifier.isValid(header(request, "X-Hub-Signature-256"), body)) return { statusCode: 401, body: "" };
    let messages;
    try {
      const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      messages = incomingTextMessages(decodeWebhookPayload(json), this.now());
    } catch {
      return { statusCode: 400, body: "" };
    }
    try {
      for (const message of messages) await this.queue.enqueue(message);
    } catch {
      // 5xx faz a Meta reenviar o evento; mensagens já enfileiradas são deduplicadas por `wamid`.
      return { statusCode: 500, body: "" };
    }
    return { statusCode: 200, body: "" };
  }
}
