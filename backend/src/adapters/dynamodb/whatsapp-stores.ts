import type { Instant } from "../../domain/dates.ts";
import { userID, type UserID } from "../../domain/ids.ts";
import {
  WhatsAppLinkError, type InboxClaim, type InboxStore, type LinkToken, type LinkTokenStore, type WhatsAppLink,
  type WhatsAppLinkStore,
} from "../../whatsapp/ports.ts";
import { DynamoConditionFailedError, DynamoTransactionCanceledError, type DynamoClient, type DynamoItem } from "./client.ts";
import { DynamoStoreError } from "./errors.ts";
import { INBOX_SK, LINK_TOKEN_SK, PHONE_LINK_SK, WHATSAPP_USER_SK, inboxPK, linkTokenPK, phonePK, ttlSeconds, userPK } from "./keys.ts";
import { decoding, integer, str } from "./reader.ts";

// Ports do WhatsApp sobre o DynamoDB (contrato: docs/BACKEND.md seção 14). Toda unicidade e idempotência é
// escrita condicional; `DynamoConditionFailedError` e o cancelamento por ação são traduzidos aqui, nunca vazam.
// O TTL (em segundos) só limpa itens velhos: a lógica usa sempre `expiresAt`, a chave da janela ou `processedAt`.

const E164 = /^\+[1-9][0-9]{7,14}$/;

export interface InboxStoreOptions {
  readonly client: DynamoClient;
  /** Quanto tempo depois de `receivedAt` o item pode ser apagado (só limpeza; sem valor padrão). */
  readonly retentionSeconds: number;
}

/** Item `WAMID#<wamid>`/`INBOX`: só `wamid` (na chave) e horários, nunca o texto da mensagem. */
export class DynamoInboxStore implements InboxStore {
  private readonly client: DynamoClient;
  private readonly retentionSeconds: number;

  constructor(options: InboxStoreOptions) {
    this.client = options.client;
    this.retentionSeconds = options.retentionSeconds;
  }

  async claim(wamid: string, receivedAt: Instant): Promise<InboxClaim> {
    try {
      await this.client.put({
        item: { PK: inboxPK(wamid), SK: INBOX_SK, receivedAt, ttl: ttlSeconds(receivedAt, this.retentionSeconds) },
        condition: "attribute_not_exists(PK) OR attribute_not_exists(#processedAt)",
        names: { "#processedAt": "processedAt" },
      });
      return "claimed";
    } catch (error) {
      if (error instanceof DynamoConditionFailedError) return "duplicate";
      throw error;
    }
  }

  async markProcessed(wamid: string, at: Instant): Promise<void> {
    await this.client.update({
      key: { PK: inboxPK(wamid), SK: INBOX_SK }, update: "SET #processedAt = :at, #ttl = :ttl",
      names: { "#processedAt": "processedAt", "#ttl": "ttl" },
      values: { ":at": at, ":ttl": ttlSeconds(at, this.retentionSeconds) }, returnValues: "UPDATED_NEW",
    });
  }
}

function linkAttributes(link: WhatsAppLink): Record<string, string | number> {
  return { userID: link.userID, phoneE164: link.phoneE164, consentedAt: link.consentedAt, linkedAt: link.linkedAt };
}

function decodeLink(item: DynamoItem): WhatsAppLink {
  return decoding(() => ({
    userID: userID(str(item, "userID")), phoneE164: str(item, "phoneE164"), consentedAt: integer(item, "consentedAt"),
    linkedAt: integer(item, "linkedAt"),
  }));
}

export interface WhatsAppLinkStoreOptions {
  readonly client: DynamoClient;
}

/** Itens `PHONE#<e164>`/`LINK` e `USER#<id>`/`WHATSAPP`; desvincular apaga os dois. */
export class DynamoWhatsAppLinkStore implements WhatsAppLinkStore {
  private readonly client: DynamoClient;

  constructor(options: WhatsAppLinkStoreOptions) {
    this.client = options.client;
  }

  async linkForPhone(phoneE164: string): Promise<WhatsAppLink | null> {
    const item = await this.client.get({ key: { PK: phonePK(phoneE164), SK: PHONE_LINK_SK }, consistentRead: true });
    return item === undefined ? null : decodeLink(item);
  }

  async linkForUser(user: UserID): Promise<WhatsAppLink | null> {
    const item = await this.client.get({ key: { PK: userPK(user), SK: WHATSAPP_USER_SK }, consistentRead: true });
    return item === undefined ? null : decodeLink(item);
  }

  async create(link: WhatsAppLink): Promise<void> {
    if (!E164.test(link.phoneE164)) throw new DynamoStoreError("invalidItem");
    const attributes = linkAttributes(link);
    try {
      await this.client.transactWrite([
        { kind: "put", item: { PK: phonePK(link.phoneE164), SK: PHONE_LINK_SK, ...attributes }, condition: "attribute_not_exists(PK)" },
        { kind: "put", item: { PK: userPK(link.userID), SK: WHATSAPP_USER_SK, ...attributes }, condition: "attribute_not_exists(PK)" },
      ]);
    } catch (error) {
      if (error instanceof DynamoTransactionCanceledError) {
        // Se os dois falharem, vale o do número (como no adaptador em memória).
        if (error.reasons[0] === "ConditionalCheckFailed") throw new WhatsAppLinkError("phoneAlreadyLinked");
        if (error.reasons[1] === "ConditionalCheckFailed") throw new WhatsAppLinkError("userAlreadyLinked");
      }
      throw error;
    }
  }

  async remove(user: UserID): Promise<void> {
    const current = await this.linkForUser(user);
    if (current === null) return;
    // O item do número só é apagado se ainda for deste morador (outro pode ter vinculado depois de um remove concorrente).
    try {
      await this.client.transactWrite([
        {
          kind: "delete", key: { PK: phonePK(current.phoneE164), SK: PHONE_LINK_SK },
          condition: "attribute_not_exists(PK) OR #userID = :user", names: { "#userID": "userID" }, values: { ":user": user },
        },
        { kind: "delete", key: { PK: userPK(user), SK: WHATSAPP_USER_SK } },
      ]);
    } catch (error) {
      if (!(error instanceof DynamoTransactionCanceledError)) throw error;
      // O número já é de outro morador: só resta apagar o vínculo deste (idempotente).
      await this.client.delete({ key: { PK: userPK(user), SK: WHATSAPP_USER_SK } });
    }
  }
}

export interface LinkTokenStoreOptions {
  readonly client: DynamoClient;
  /** Folga do `ttl` depois de `expiresAt` (a validade é decidida pela condição, nunca pelo TTL). */
  readonly graceSeconds: number;
}

/** Item `LINKTOKEN#<sha256>`: uso único; só o hash é persistido. */
export class DynamoLinkTokenStore implements LinkTokenStore {
  private readonly client: DynamoClient;
  private readonly graceSeconds: number;

  constructor(options: LinkTokenStoreOptions) {
    this.client = options.client;
    this.graceSeconds = options.graceSeconds;
  }

  async save(token: LinkToken): Promise<void> {
    await this.client.put({
      item: {
        PK: linkTokenPK(token.tokenHash), SK: LINK_TOKEN_SK, userID: token.userID, expiresAt: token.expiresAt,
        ttl: ttlSeconds(token.expiresAt, this.graceSeconds),
      },
    });
  }

  async consume(tokenHash: string, at: Instant): Promise<UserID | null> {
    try {
      const item = await this.client.update({
        key: { PK: linkTokenPK(tokenHash), SK: LINK_TOKEN_SK }, update: "SET #usedAt = :at",
        condition: "attribute_exists(PK) AND attribute_not_exists(#usedAt) AND #expiresAt > :at",
        names: { "#usedAt": "usedAt", "#expiresAt": "expiresAt" }, values: { ":at": at }, returnValues: "ALL_NEW",
      });
      return decoding(() => userID(str(item, "userID")));
    } catch (error) {
      if (error instanceof DynamoConditionFailedError) return null;
      throw error;
    }
  }
}
