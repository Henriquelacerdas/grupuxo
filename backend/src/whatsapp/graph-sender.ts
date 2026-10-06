import type { HttpFetch } from "../http.ts";
import type { WhatsAppSender } from "./ports.ts";

// Envio de mensagens de texto pela Graph API da Meta (WhatsApp Cloud API). Nenhuma mensagem de erro carrega o
// corpo da resposta, o token, o texto da mensagem nem o telefone do destinatário.

/** Configuração ausente ou inválida (falha fechada, na composição, antes de qualquer chamada). */
export class GraphConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphConfigurationError";
  }
}

export type GraphSendErrorCode =
  /** A requisição não chegou à Graph API (DNS, conexão, TLS...). */
  | "network"
  | "timeout"
  /** A Graph API respondeu com status diferente de 2xx (inclui 429 e 5xx). */
  | "status"
  /** O telefone não está em E.164 com `+`: nada foi enviado. */
  | "invalidRecipient"
  /** Texto vazio: a Graph API recusaria. */
  | "emptyMessage";

const SEND_ERROR_MESSAGES: Readonly<Record<GraphSendErrorCode, string>> = {
  network: "Falha de rede ao enviar mensagem pelo WhatsApp",
  timeout: "A Graph API não respondeu a tempo",
  status: "A Graph API recusou o envio",
  invalidRecipient: "Telefone de destino inválido",
  emptyMessage: "Mensagem vazia",
};

/**
 * Falha ao enviar. Mensagem fixa por código. `status` traz o status HTTP quando `code` é `"status"`: permite uma
 * política futura que não repita erros permanentes (4xx, exceto 429); hoje todo erro propaga e o SQS tenta de novo.
 */
export class GraphSendError extends Error {
  readonly code: GraphSendErrorCode;
  readonly status: number | null;

  constructor(code: GraphSendErrorCode, status: number | null = null) {
    super(SEND_ERROR_MESSAGES[code]);
    this.name = "GraphSendError";
    this.code = code;
    this.status = status;
  }
}

export interface GraphWhatsAppSenderOptions {
  /** Token permanente do System User (Secrets Manager, `WHATSAPP_TOKEN`). Vai só no cabeçalho `Authorization`. */
  readonly accessToken: string | undefined;
  /** `PHONE_NUMBER_ID` do número do bot. Entra na URL, por isso só dígitos. */
  readonly phoneNumberID: string | undefined;
  /** Versão da Graph API (`WHATSAPP_GRAPH_VERSION`, ex.: `v25.0`). Sem valor, o sender não é criado. */
  readonly apiVersion: string | undefined;
  readonly http: HttpFetch;
  /** Padrão: 10 s. */
  readonly timeoutMs?: number;
}

const GRAPH_ORIGIN = "https://graph.facebook.com/";
const VERSION_PATTERN = /^v[0-9]{1,3}\.[0-9]{1,2}$/;
const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,20}$/;
const ACCESS_TOKEN_PATTERN = /^[\x21-\x7e]{1,512}$/;
const RECIPIENT_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/** Limite de `text.body` da Cloud API. */
export const MAX_MESSAGE_CHARS = 4096;
const ELLIPSIS = "…";

/** Corta em `MAX_MESSAGE_CHARS` pontos de código (nunca no meio de um par substituto), com reticências no corte. */
export function truncateMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  const codePoints = [...text];
  if (codePoints.length <= MAX_MESSAGE_CHARS) return text;
  return `${codePoints.slice(0, MAX_MESSAGE_CHARS - 1).join("")}${ELLIPSIS}`;
}

export class GraphWhatsAppSender implements WhatsAppSender {
  private readonly url: string;
  private readonly accessToken: string;
  private readonly http: HttpFetch;
  private readonly timeoutMs: number;

  constructor(options: GraphWhatsAppSenderOptions) {
    const { accessToken, phoneNumberID, apiVersion } = options;
    if (apiVersion === undefined || apiVersion === "") throw new GraphConfigurationError("WHATSAPP_GRAPH_VERSION não configurada");
    if (!VERSION_PATTERN.test(apiVersion)) throw new GraphConfigurationError("WHATSAPP_GRAPH_VERSION inválida");
    if (phoneNumberID === undefined || !PHONE_NUMBER_ID_PATTERN.test(phoneNumberID)) {
      throw new GraphConfigurationError("PHONE_NUMBER_ID ausente ou inválido");
    }
    if (accessToken === undefined || !ACCESS_TOKEN_PATTERN.test(accessToken)) {
      throw new GraphConfigurationError("WHATSAPP_TOKEN ausente ou inválido");
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new GraphConfigurationError("timeout da Graph API inválido");
    this.url = `${GRAPH_ORIGIN}${apiVersion}/${phoneNumberID}/messages`;
    this.accessToken = accessToken;
    this.http = options.http;
    this.timeoutMs = timeoutMs;
  }

  /**
   * `toPhone` em E.164 com `+` (`+5511999998888`), como o vínculo o guarda: a documentação da Meta recomenda o `+` e
   * o código do país, então o campo `to` é enviado exatamente assim, sem nova normalização.
   */
  async send(text: string, toPhone: string): Promise<void> {
    if (!RECIPIENT_PATTERN.test(toPhone)) throw new GraphSendError("invalidRecipient");
    if (text === "") throw new GraphSendError("emptyMessage");
    try {
      const response = await this.http(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.accessToken}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toPhone,
          type: "text",
          text: { body: truncateMessage(text) },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new GraphSendError("status", response.status);
    } catch (error) {
      if (error instanceof GraphSendError) throw error;
      // O erro original não é repassado: nada dele precisa chegar a log ou resposta.
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new GraphSendError(timedOut ? "timeout" : "network");
    }
  }
}
