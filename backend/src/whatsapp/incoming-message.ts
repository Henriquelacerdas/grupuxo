import type { Instant } from "../domain/dates.ts";

/**
 * Mensagem de texto recebida do WhatsApp, já extraída do payload da Meta: é o corpo que o webhook enfileira
 * e que o worker consome. O texto é entrada não confiável e nunca é persistido nem registrado em log.
 */
export interface IncomingMessage {
  /** ID da mensagem na Meta. Chave de idempotência (item `WAMID#<wamid>`) e `MessageDeduplicationId` do SQS FIFO. */
  readonly wamid: string;
  /** Remetente em E.164 (`+5511999998888`). `MessageGroupId` do SQS FIFO. */
  readonly phoneE164: string;
  readonly text: string;
  readonly receivedAt: Instant;
}

/** Valida uma mensagem vinda da fila (JSON desconhecido). Falha com `TypeError` se a forma estiver errada. */
export function parseIncomingMessage(value: unknown): IncomingMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("mensagem inválida");
  const { wamid, phoneE164, text, receivedAt } = Object.fromEntries(Object.entries(value));
  if (
    typeof wamid !== "string" || typeof phoneE164 !== "string" || typeof text !== "string" ||
    typeof receivedAt !== "number" || !Number.isFinite(receivedAt)
  ) {
    throw new TypeError("mensagem inválida");
  }
  return { wamid, phoneE164, text, receivedAt };
}
