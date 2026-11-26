import { createCipheriv, createECDH, createPrivateKey, createSign, hkdfSync, randomBytes, type KeyObject } from "node:crypto";
import type { Instant } from "../domain/dates.ts";
import type { HttpBinaryFetch } from "../http.ts";
import { pushArguments } from "./apns-sender.ts";
import { base64urlBytes, type PushMessage, type PushResult, type PushSender, type WebPushDevice } from "./push.ts";

// Web Push (site): corpo cifrado pelo RFC 8291 (aes128gcm do RFC 8188, ECDH P-256 + HKDF-SHA-256) e autenticação
// VAPID do RFC 8292 (JWT ES256 no cabeçalho `Authorization: vapid t=…, k=…`). O HTTP vem por `HttpBinaryFetch` (`src/http.ts`). O corpo leva
// só dados (`{ kind, key, args, url }`): o service worker do site monta a frase. Mensagens de erro fixas, sem endpoint,
// chave nem conteúdo.

export class WebPushError extends Error {
  constructor(problem: "invalidSubscription" | "invalidVapidKeys" | "invalidSubject") {
    super(`webPush: ${problem}`);
    this.name = "WebPushError";
  }
}

/** Par de chaves VAPID do servidor (segredo `grupuxo/<ambiente>/webpush`), em base64url. */
export interface VapidKeys {
  /** Ponto P-256 não comprimido (65 bytes): o `applicationServerKey` que o site passa ao `pushManager.subscribe`. */
  readonly publicKey: string;
  /** Escalar privado P-256 (32 bytes). */
  readonly privateKey: string;
}

/** Contato do servidor no JWT do VAPID (`sub`): `mailto:` ou URL `https:` (RFC 8292 seção 2.1). */
export function validVapidSubject(subject: string): boolean {
  return /^mailto:[^\s@]+@[^\s@]+$/.test(subject) || /^https:\/\/[^\s]+$/.test(subject);
}

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
/** Corpo máximo que todo serviço de push aceita (RFC 8291 seção 4: 4096 bytes cifrados, um único registro). */
const MAX_PLAINTEXT = RECORD_SIZE - TAG_LENGTH - 1 - 86;

function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

export interface Aes128gcmInput {
  readonly plaintext: Uint8Array;
  /** `p256dh` do navegador (65 bytes). */
  readonly uaPublic: Uint8Array;
  /** `auth` do navegador (16 bytes). */
  readonly authSecret: Uint8Array;
  /** Par efêmero do servidor (escalar de 32 bytes e ponto não comprimido de 65): novo a cada mensagem. */
  readonly asPrivate: Uint8Array;
  readonly asPublic: Uint8Array;
  /** 16 bytes aleatórios, novos a cada mensagem. */
  readonly salt: Uint8Array;
}

/**
 * Cifra uma mensagem para uma inscrição (RFC 8291 seção 3.4, um único registro do RFC 8188 com o delimitador 0x02 e sem
 * preenchimento). Devolve o corpo completo: cabeçalho (salt, tamanho do registro, chave pública do servidor) e registro.
 */
export function encryptAes128gcm(input: Aes128gcmInput): Buffer {
  if (input.uaPublic.length !== 65 || input.uaPublic[0] !== 0x04 || input.authSecret.length !== 16 || input.salt.length !== 16) {
    throw new WebPushError("invalidSubscription");
  }
  if (input.plaintext.length > MAX_PLAINTEXT) throw new RangeError("webPush: corpo grande demais");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(input.asPrivate);
  let ecdhSecret: Buffer;
  try {
    ecdhSecret = ecdh.computeSecret(input.uaPublic);
  } catch {
    throw new WebPushError("invalidSubscription");
  }
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), input.uaPublic, input.asPublic]);
  const ikm = hkdf(input.authSecret, ecdhSecret, keyInfo, 32);
  const cek = hkdf(input.salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16);
  const nonce = hkdf(input.salt, ikm, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([cipher.update(input.plaintext), cipher.update(Uint8Array.of(0x02)), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([input.salt, recordSize, Uint8Array.of(input.asPublic.length), input.asPublic, record]);
}

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const publicKey = base64urlBytes(keys.publicKey);
  const privateKey = base64urlBytes(keys.privateKey);
  if (publicKey === null || publicKey.length !== 65 || publicKey[0] !== 0x04 || privateKey === null || privateKey.length !== 32) {
    throw new WebPushError("invalidVapidKeys");
  }
  try {
    const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
    const key = createPrivateKey({
      key: { kty: "EC", crv: "P-256", d: b64(privateKey), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33)) },
      format: "jwk",
    });
    // A chave pública tem de ser a do escalar: o navegador confere a assinatura com o `k` do cabeçalho.
    const derived = createECDH("prime256v1");
    derived.setPrivateKey(privateKey);
    if (!derived.getPublicKey().equals(publicKey)) throw new WebPushError("invalidVapidKeys");
    return key;
  } catch {
    throw new WebPushError("invalidVapidKeys");
  }
}

/** JWT do VAPID (RFC 8292 seção 2): `aud` = origem do serviço de push, `exp` em até 24 h, `sub` = contato. */
export function vapidJwt(privateKey: KeyObject, audience: string, subject: string, expiresAt: Instant): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({ aud: audience, exp: Math.floor(expiresAt / 1000), sub: subject })}`;
  const signature = createSign("SHA256").update(unsigned).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}

/** Destino do clique no aviso, relativo à origem do site (o service worker só aceita `^/app(/[A-Za-z0-9-]+)*$`). */
const URLS = { notification: "/app/notifications", dailyTasks: "/app/tasks" } as const;

/**
 * Corpo do Web Push (antes da cifra), no formato que o service worker do site (`web/public/sw.js`) lê. Aviso da casa:
 * `{ kind, key, args, url }`, com `key` e `args` exatamente os do APNs (`push.<kind>` ou `.anon`, `pushArguments`).
 * Lembrete diário: `{ kind: "dailyTasks", args: [quantidade], url }`. Nenhuma frase pronta.
 */
export function webPushPayload(message: PushMessage): string {
  if (message.kind === "dailyTasks") return JSON.stringify({ kind: "dailyTasks", args: [message.count], url: URLS.dailyTasks });
  const { suffix, args } = pushArguments(message);
  return JSON.stringify({ kind: message.kind, key: `push.${message.kind}${suffix}`, args: [...args], url: URLS.notification });
}

/** Tempo que o serviço de push guarda a mensagem para um navegador desligado (cabeçalho `TTL`, segundos). */
const TTL_SECONDS = { notification: 24 * 60 * 60, dailyTasks: 12 * 60 * 60 } as const;
/** O JWT vale 12 h e é renovado a cada 6 h (por origem do serviço de push). */
const JWT_LIFETIME_MS = 12 * 60 * 60 * 1000;
const JWT_RENEW_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface WebPushSenderOptions {
  /** Chaves VAPID; buscadas no primeiro envio (o segredo pode ainda não ter valor: o envio falha e o próximo tenta de novo). */
  readonly vapidKeys: () => Promise<VapidKeys>;
  /** `WEBPUSH_SUBJECT` (`mailto:` ou `https:`), sem valor padrão. */
  readonly subject: string;
  readonly http: HttpBinaryFetch;
  readonly now: () => Instant;
  /** Par efêmero e salt de cada mensagem; o padrão é aleatório (`node:crypto`). Os testes fixam. */
  readonly ephemeral?: () => { readonly privateKey: Uint8Array; readonly publicKey: Uint8Array; readonly salt: Uint8Array };
}

function randomEphemeral(): { privateKey: Uint8Array; publicKey: Uint8Array; salt: Uint8Array } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), salt: randomBytes(16) };
}

export class WebPushSender implements PushSender<WebPushDevice> {
  private readonly vapidKeys: () => Promise<VapidKeys>;
  private readonly subject: string;
  private readonly http: HttpBinaryFetch;
  private readonly now: () => Instant;
  private readonly ephemeral: NonNullable<WebPushSenderOptions["ephemeral"]>;
  private signer: { readonly key: KeyObject; readonly publicKey: string } | null = null;
  private readonly jwts = new Map<string, { readonly jwt: string; readonly at: Instant }>();

  constructor(options: WebPushSenderOptions) {
    if (!validVapidSubject(options.subject)) throw new WebPushError("invalidSubject");
    this.vapidKeys = options.vapidKeys;
    this.subject = options.subject;
    this.http = options.http;
    this.now = options.now;
    this.ephemeral = options.ephemeral ?? randomEphemeral;
  }

  private async authorization(audience: string): Promise<string> {
    if (this.signer === null) {
      const keys = await this.vapidKeys();
      this.signer = { key: vapidPrivateKey(keys), publicKey: keys.publicKey };
    }
    const at = this.now();
    let cached = this.jwts.get(audience);
    if (cached === undefined || at - cached.at > JWT_RENEW_MS) {
      cached = { jwt: vapidJwt(this.signer.key, audience, this.subject, at + JWT_LIFETIME_MS), at };
      this.jwts.set(audience, cached);
    }
    return `vapid t=${cached.jwt}, k=${this.signer.publicKey}`;
  }

  async send(device: WebPushDevice, message: PushMessage): Promise<PushResult> {
    try {
      const uaPublic = base64urlBytes(device.p256dh);
      const authSecret = base64urlBytes(device.auth);
      if (uaPublic === null || authSecret === null) return "invalidToken";
      const audience = new URL(device.endpoint).origin;
      const authorization = await this.authorization(audience);
      const { privateKey, publicKey, salt } = this.ephemeral();
      let body: Buffer;
      try {
        body = encryptAes128gcm({
          plaintext: Buffer.from(webPushPayload(message), "utf8"), uaPublic, authSecret, asPrivate: privateKey, asPublic: publicKey, salt,
        });
      } catch (error) {
        if (error instanceof WebPushError) return "invalidToken";
        throw error;
      }
      const kind = message.kind === "dailyTasks" ? "dailyTasks" : "notification";
      const response = await this.http(device.endpoint, {
        method: "POST",
        headers: {
          authorization, "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
          ttl: String(TTL_SECONDS[kind]), urgency: "normal",
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status >= 200 && response.status < 300) return "sent";
      // 404/410: a inscrição não existe mais (o navegador saiu ou revogou); deve sair do diretório.
      return response.status === 404 || response.status === 410 ? "invalidToken" : "failed";
    } catch {
      return "failed";
    }
  }
}
