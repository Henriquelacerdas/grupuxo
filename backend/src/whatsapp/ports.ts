import type { Instant } from "../domain/dates.ts";
import type { UserID } from "../domain/ids.ts";
import type { IncomingMessage } from "./incoming-message.ts";

// Persistência e integrações externas entram só por estes ports. A implementação DynamoDB deve passar nos
// mesmos testes de contrato dos adaptadores em memória (`test/contract`). Modelo de itens: BACKEND.md seção 4.

export type InboxClaim =
  /** Primeira entrega, ou entrega anterior que não chegou a ser concluída: processar. */
  | "claimed"
  /** Já processada com sucesso: descartar. */
  | "duplicate";

/** Idempotência e auditoria (item `WAMID#<wamid>`). Só guarda `wamid` e horários, nunca o texto da mensagem. */
export interface InboxStore {
  /**
   * Registra o `wamid` se for novo. Uma mensagem registrada mas ainda sem `processedAt` (o worker caiu no
   * meio) volta como `claimed`, para a nova tentativa não perdê-la. No DynamoDB: `PutItem` em `WAMID#<wamid>`
   * com condição `attribute_not_exists(PK) OR attribute_not_exists(processedAt)`;
   * `ConditionalCheckFailedException` vira `duplicate`.
   */
  claim(wamid: string, receivedAt: Instant): Promise<InboxClaim>;
  markProcessed(wamid: string, at: Instant): Promise<void>;
}

/** Vínculo entre um número de WhatsApp e um morador (itens `PHONE#<e164>` e `USER#<id>`/`WHATSAPP`). */
export interface WhatsAppLink {
  readonly userID: UserID;
  readonly phoneE164: string;
  readonly consentedAt: Instant;
  readonly linkedAt: Instant;
}

export type WhatsAppLinkErrorCode =
  /** O número é único: um número, um morador. */
  | "phoneAlreadyLinked"
  /** Um morador tem no máximo um número; para trocar, desconectar e conectar de novo. */
  | "userAlreadyLinked";

export class WhatsAppLinkError extends Error {
  readonly code: WhatsAppLinkErrorCode;

  constructor(code: WhatsAppLinkErrorCode) {
    super(code);
    this.name = "WhatsAppLinkError";
    this.code = code;
  }
}

export interface WhatsAppLinkStore {
  linkForPhone(phoneE164: string): Promise<WhatsAppLink | null>;
  linkForUser(userID: UserID): Promise<WhatsAppLink | null>;
  /** Lança `WhatsAppLinkError` se o número ou o morador já tiverem vínculo. */
  create(link: WhatsAppLink): Promise<void>;
  /** Idempotente: sem vínculo, não faz nada. */
  remove(userID: UserID): Promise<void>;
}

/** Token de vínculo de uso único (item `LINKTOKEN#<hash>`). Só o hash é persistido. */
export interface LinkToken {
  /** SHA-256 do token em hexadecimal minúsculo. */
  readonly tokenHash: string;
  readonly userID: UserID;
  readonly expiresAt: Instant;
}

export interface LinkTokenStore {
  save(token: LinkToken): Promise<void>;
  /**
   * Atômico: se o token existe, não foi usado e não expirou em `at`, marca como usado e devolve o dono; senão
   * `null`. No DynamoDB: `UpdateItem` com `SET usedAt = :at` e condição
   * `attribute_exists(PK) AND attribute_not_exists(usedAt) AND expiresAt > :at` (`ReturnValues: ALL_NEW`);
   * `ConditionalCheckFailedException` vira `null`.
   */
  consume(tokenHash: string, at: Instant): Promise<UserID | null>;
}

/** Fila entre o webhook e o worker (SQS FIFO em produção): `phoneE164` é o `MessageGroupId`, `wamid` a deduplicação. */
export interface MessageQueue {
  enqueue(message: IncomingMessage): Promise<void>;
}

/**
 * Decide a resposta para uma mensagem de um morador já identificado. O `userID` vem do vínculo do número,
 * nunca do texto. O Gemini com as ferramentas de leitura será a implementação definitiva.
 */
export interface MessageResponder {
  reply(text: string, userID: UserID): Promise<string>;
}

export class EchoResponder implements MessageResponder {
  async reply(text: string, _userID: UserID): Promise<string> {
    return `Você disse: ${text}`;
  }
}

/** Envio de mensagens pela Graph API da Meta. */
export interface WhatsAppSender {
  send(text: string, toPhone: string): Promise<void>;
}

/**
 * Contador por chave e janela, base do limite de taxa por número (`MessageRateLimiter`). Atômico: chamadas
 * concorrentes com a mesma chave e janela recebem contagens distintas e consecutivas. No DynamoDB:
 * `UpdateItem` em (`RATE#<key>`, `<windowStart>`) com `ADD #count :one SET #ttl = :ttl`
 * (`ReturnValues: UPDATED_NEW`); o TTL apaga as janelas antigas.
 */
export interface RateCounter {
  /** Soma 1 à contagem de (`key`, `windowStart`) e devolve o novo valor (1 na primeira chamada). */
  increment(key: string, windowStart: Instant): Promise<number>;
}
