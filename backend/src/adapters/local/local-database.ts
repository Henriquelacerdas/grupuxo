import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseCognitoSub, type CognitoSub } from "../../auth/token-verifier.ts";
import type { Instant } from "../../domain/dates.ts";
import { taskOccurrenceID, userID, type IDGenerator, type UserID } from "../../domain/ids.ts";
import { emptyStoreState, type StoreState } from "../../domain/store-state.ts";
import type { LinkToken, PendingCompletion, WhatsAppLink } from "../../whatsapp/ports.ts";
import { InMemoryPendingActionStore } from "../in-memory/pending-actions.ts";
import { InMemoryRateCounter } from "../in-memory/rate-counter.ts";
import { InMemoryStore } from "../in-memory/store.ts";
import { InMemoryUserDirectory } from "../in-memory/user-directory.ts";
import { InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore } from "../in-memory/whatsapp.ts";

// Banco local de demonstração: os adaptadores em memória de sempre, gravados num único arquivo JSON. O processo
// é único e cada operação roda sem intercalar, então não há concorrência a resolver; a escrita é por
// arquivo temporário + `rename`, para uma queda no meio nunca deixar o arquivo pela metade.

const FORMAT_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Retenções (só limpeza; a validade de cada coisa é decidida por condição): mesmas ideias do TTL do DynamoDB. */
const INBOX_RETENTION_MS = 7 * DAY_MS;
const RATE_RETENTION_MS = DAY_MS;
const SAVE_DELAY_MS = 200;

/** Mensagem fixa: nunca repete conteúdo do arquivo. */
export class LocalDatabaseError extends Error {
  constructor() {
    super("arquivo do banco local inválido");
    this.name = "LocalDatabaseError";
  }
}

export interface LocalDatabaseOptions {
  /** Caminho do arquivo JSON. Se não existir, o banco começa vazio. */
  readonly path: string;
  readonly now: () => Instant;
  readonly newID: IDGenerator;
}

type Fields = Readonly<Record<string, unknown>>;

function bad(): never {
  throw new LocalDatabaseError();
}

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: unknown): Fields {
  return isFields(value) ? value : bad();
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : bad();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : bad();
}

function whole(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : bad();
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function nullableWhole(value: unknown): number | null {
  return value === null ? null : whole(value);
}

function pair(value: unknown): readonly [unknown, unknown] {
  const items = array(value);
  if (items.length !== 2) bad();
  return [items[0], items[1]];
}

const STATE_KEYS: readonly (keyof StoreState)[] = Object.keys(emptyStoreState()).filter(
  (key): key is keyof StoreState => key in emptyStoreState(),
);

/** Confere a forma do estado: as 11 listas existem e só têm objetos. O conteúdo de cada entidade foi escrito por este processo. */
function isStoreState(value: unknown): value is StoreState {
  if (!isFields(value)) return false;
  return STATE_KEYS.every((key) => {
    const items = value[key];
    return Array.isArray(items) && items.every(isFields);
  });
}

function stateOf(value: unknown): StoreState {
  return isStoreState(value) ? value : bad();
}

function linkOf(value: unknown): WhatsAppLink {
  const raw = fields(value);
  return { userID: userID(text(raw["userID"])), phoneE164: text(raw["phoneE164"]), consentedAt: whole(raw["consentedAt"]), linkedAt: whole(raw["linkedAt"]) };
}

function tokenOf(value: unknown): LinkToken {
  const raw = fields(value);
  return { tokenHash: text(raw["tokenHash"]), userID: userID(text(raw["userID"])), expiresAt: whole(raw["expiresAt"]) };
}

function pendingOf(value: unknown): PendingCompletion {
  const raw = fields(value);
  return {
    userID: userID(text(raw["userID"])),
    occurrenceID: taskOccurrenceID(text(raw["occurrenceID"])),
    createdAt: whole(raw["createdAt"]),
    expiresAt: whole(raw["expiresAt"]),
    confirmedByWamid: nullableText(raw["confirmedByWamid"]),
  };
}

function subOf(value: unknown): CognitoSub {
  return parseCognitoSub(text(value)) ?? bad();
}

export class LocalDatabase {
  readonly store: InMemoryStore;
  readonly users: InMemoryUserDirectory;
  readonly inbox = new InMemoryInboxStore();
  readonly linkTokens = new InMemoryLinkTokenStore();
  readonly links = new InMemoryWhatsAppLinkStore();
  readonly rateCounter = new InMemoryRateCounter();
  readonly pending = new InMemoryPendingActionStore();

  private readonly options: LocalDatabaseOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  /**
   * Abre o banco: lê o arquivo (se existir) e valida a forma antes de aceitar qualquer coisa. Arquivo ilegível
   * ou fora do formato lança `LocalDatabaseError` (falha fechada: nunca recomeça vazio por cima de dados).
   */
  static open(options: LocalDatabaseOptions): LocalDatabase {
    return new LocalDatabase(options, existsSync(options.path) ? readFileSync(options.path, "utf8") : null);
  }

  private constructor(options: LocalDatabaseOptions, content: string | null) {
    this.options = options;
    let initial = emptyStoreState();
    let parsed: Fields | null = null;
    if (content !== null) {
      try {
        parsed = fields(JSON.parse(content));
        if (parsed["version"] !== FORMAT_VERSION) bad();
        initial = stateOf(parsed["state"]);
      } catch {
        throw new LocalDatabaseError();
      }
    }
    this.store = new InMemoryStore(initial);
    this.users = new InMemoryUserDirectory(this.store, options.newID);
    if (parsed !== null) {
      try {
        this.users.restore(array(parsed["users"]).map((entry): [CognitoSub, UserID] => {
          const [sub, id] = pair(entry);
          return [subOf(sub), userID(text(id))];
        }));
        this.inbox.restore(array(parsed["inbox"]).map((entry): [string, Instant | null] => {
          const [wamid, at] = pair(entry);
          return [text(wamid), nullableWhole(at)];
        }));
        const tokens = fields(parsed["linkTokens"]);
        this.linkTokens.restore(array(tokens["tokens"]).map(tokenOf), array(tokens["used"]).map(text));
        this.links.restore(array(parsed["links"]).map(linkOf));
        this.rateCounter.restore(array(parsed["rate"]).map((entry): [string, number] => {
          const [id, count] = pair(entry);
          return [text(id), whole(count)];
        }));
        this.pending.restore(array(parsed["pending"]).map(pendingOf));
      } catch {
        throw new LocalDatabaseError();
      }
    }
    const changed = (): void => this.scheduleSave();
    this.store.onChange = changed;
    this.users.onChange = changed;
    this.inbox.onChange = changed;
    this.linkTokens.onChange = changed;
    this.links.onChange = changed;
    this.rateCounter.onChange = changed;
    this.pending.onChange = changed;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY_MS);
    // Não segura o processo vivo só por causa da gravação pendente (o desligamento chama `flush`).
    this.timer.unref();
  }

  /** Grava agora, se houver mudança pendente. Chamar no desligamento. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const now = this.options.now();
    const snapshot = {
      version: FORMAT_VERSION,
      state: this.store.snapshot(),
      users: this.users.snapshot(),
      inbox: this.inbox.snapshot(now - INBOX_RETENTION_MS),
      linkTokens: this.linkTokens.snapshot(),
      links: this.links.snapshot(),
      rate: this.rateCounter.snapshot(now - RATE_RETENTION_MS),
      pending: this.pending.snapshot(),
    };
    mkdirSync(dirname(this.options.path), { recursive: true });
    const temporary = `${this.options.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    renameSync(temporary, this.options.path);
  }
}
