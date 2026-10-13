import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import type { IncomingMessage } from "../../whatsapp/incoming-message.ts";
import {
  WhatsAppLinkError, type InboxClaim, type InboxStore, type LinkToken, type LinkTokenStore, type MessageQueue,
  type WhatsAppLink, type WhatsAppLinkStore, type WhatsAppSender,
} from "../../whatsapp/ports.ts";

// Em JavaScript cada método roda até o fim sem intercalar, então cada operação abaixo é atômica (sem `await`
// entre ler e gravar), como as escritas condicionais do adaptador DynamoDB serão (`ConditionExpression`,
// `TransactWriteItems`).

export class InMemoryInboxStore implements InboxStore {
  private readonly processedAt = new Map<string, Instant | null>();
  /** Chamado depois de cada mudança (persistência local). */
  onChange: (() => void) | null = null;

  async claim(wamid: string, _receivedAt: Instant): Promise<InboxClaim> {
    if (this.processedAt.get(wamid) !== undefined && this.processedAt.get(wamid) !== null) return "duplicate";
    this.processedAt.set(wamid, null);
    this.onChange?.();
    return "claimed";
  }

  async markProcessed(wamid: string, at: Instant): Promise<void> {
    this.processedAt.set(wamid, at);
    this.onChange?.();
  }

  /** Pares `[wamid, processedAt]`; só as mensagens processadas depois de `keepFrom` (o resto é limpeza). */
  snapshot(keepFrom: Instant): [string, Instant | null][] {
    return [...this.processedAt].filter(([, at]) => at === null || at >= keepFrom);
  }

  restore(entries: readonly (readonly [string, Instant | null])[]): void {
    this.processedAt.clear();
    for (const [wamid, at] of entries) this.processedAt.set(wamid, at);
  }
}

export class InMemoryLinkTokenStore implements LinkTokenStore {
  private readonly tokens = new Map<string, LinkToken>();
  private readonly used = new Set<string>();
  /** Chamado depois de cada mudança (persistência local). */
  onChange: (() => void) | null = null;

  async save(token: LinkToken): Promise<void> {
    this.tokens.set(token.tokenHash, token);
    this.onChange?.();
  }

  async consume(tokenHash: string, at: Instant): Promise<UserID | null> {
    const token = this.tokens.get(tokenHash);
    if (token === undefined || this.used.has(tokenHash) || !(token.expiresAt > at)) return null;
    this.used.add(tokenHash);
    this.onChange?.();
    return token.userID;
  }

  snapshot(): { tokens: LinkToken[]; used: string[] } {
    return { tokens: [...this.tokens.values()], used: [...this.used] };
  }

  restore(tokens: readonly LinkToken[], used: readonly string[]): void {
    this.tokens.clear();
    this.used.clear();
    for (const token of tokens) this.tokens.set(token.tokenHash, token);
    for (const hash of used) this.used.add(hash);
  }
}

export class InMemoryMessageQueue implements MessageQueue {
  private pending: IncomingMessage[] = [];

  async enqueue(message: IncomingMessage): Promise<void> {
    this.pending.push(message);
  }

  /** Entrega e esvazia as mensagens pendentes, na ordem de chegada. */
  drain(): IncomingMessage[] {
    const result = this.pending;
    this.pending = [];
    return result;
  }
}

export class InMemoryWhatsAppLinkStore implements WhatsAppLinkStore {
  private readonly byUser = new Map<UserID, WhatsAppLink>();
  /** Chamado depois de cada mudança (persistência local). */
  onChange: (() => void) | null = null;

  snapshot(): WhatsAppLink[] {
    return [...this.byUser.values()];
  }

  restore(links: readonly WhatsAppLink[]): void {
    this.byUser.clear();
    for (const link of links) this.byUser.set(link.userID, link);
  }

  async linkForPhone(phoneE164: string): Promise<WhatsAppLink | null> {
    return this.findByPhone(phoneE164);
  }

  private findByPhone(phoneE164: string): WhatsAppLink | null {
    for (const link of this.byUser.values()) if (link.phoneE164 === phoneE164) return link;
    return null;
  }

  async linkForUser(userID: UserID): Promise<WhatsAppLink | null> {
    return this.byUser.get(userID) ?? null;
  }

  async create(link: WhatsAppLink): Promise<void> {
    // Sem `await` entre verificar e gravar: a operação é atômica.
    if (this.findByPhone(link.phoneE164) !== null) throw new WhatsAppLinkError("phoneAlreadyLinked");
    if (this.byUser.has(link.userID)) throw new WhatsAppLinkError("userAlreadyLinked");
    this.byUser.set(link.userID, link);
    this.onChange?.();
  }

  async remove(userID: UserID): Promise<void> {
    this.byUser.delete(userID);
    this.onChange?.();
  }
}

export interface SentMessage {
  readonly phoneE164: string;
  readonly text: string;
}

/** Guarda as mensagens em vez de chamar a Graph API. */
export class InMemoryWhatsAppSender implements WhatsAppSender {
  readonly sent: SentMessage[] = [];

  async send(text: string, toPhone: string): Promise<void> {
    this.sent.push({ phoneE164: toPhone, text });
  }
}
