import { createSign } from "node:crypto";
import type { Instant } from "../domain/dates.ts";
import type { PushDevice, PushMessage, PushResult, PushSender } from "./push.ts";

// Envio ao APNs com autenticação por token (JWT ES256, chave .p8). O HTTP/2 vem por `ApnsTransport` (o ponto de
// entrada usa `node:http2`); aqui só há o JWT e o corpo do aviso. Mensagem de erro sem token, chave ou conteúdo.

export interface ApnsTransport {
  post(host: string, path: string, headers: Readonly<Record<string, string>>, body: string): Promise<{ readonly status: number }>;
}

export interface ApnsCredentials {
  readonly keyID: string;
  readonly teamID: string;
  /** Tópico = bundle ID do app. */
  readonly bundleID: string;
  /** Chave privada PKCS#8 (o conteúdo do .p8). */
  readonly privateKey: string;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

/** JWT do APNs: vale por até 1 hora; o sender renova a cada 40 minutos. */
export function apnsJwt(credentials: ApnsCredentials, at: Instant): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyID, typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: credentials.teamID, iat: Math.floor(at / 1000) }));
  const signature = createSign("SHA256").update(`${header}.${claims}`).sign({ key: credentials.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * Argumentos do texto de cada tipo, na ordem das chaves `push.<kind>` do app: quem fez e o assunto (tarefa ou cômodo),
 * só o assunto (nome do morador ou do cômodo) ou nenhum. Sem quem fez, o tipo vai para a variante `.anon`.
 */
export function pushArguments(message: PushMessage): { readonly suffix: string; readonly args: readonly string[] } {
  const subject = message.subjectName ?? "";
  switch (message.kind) {
    case "memberJoined": case "memberLeft": case "cycleTurned": case "roomAccessApproved": case "roomAccessDenied":
      return { suffix: "", args: [subject] };
    case "weeklySummaryReady": case "taskSwapRequested": case "taskSwapAccepted": case "taskSwapRejected":
      return { suffix: "", args: [] };
    case "taskEdited": case "taskDeleted": case "effortChanged": case "roomDeleted": case "roomAccessRequested":
      return message.actorName === null ? { suffix: ".anon", args: [subject] } : { suffix: "", args: [message.actorName, subject] };
  }
}

/** Corpo do aviso: o texto vem das chaves `push.<kind>` do app (nenhuma frase pronta sai do servidor). */
export function apnsPayload(message: PushMessage): string {
  const { suffix, args } = pushArguments(message);
  return JSON.stringify({
    aps: { alert: { "loc-key": `push.${message.kind}${suffix}`, "loc-args": [...args] }, sound: "default" },
    kind: message.kind,
  });
}

export class ApnsPushSender implements PushSender {
  private readonly credentials: ApnsCredentials;
  private readonly transport: ApnsTransport;
  private readonly now: () => Instant;
  private cached: { readonly jwt: string; readonly at: Instant } | null = null;

  constructor(options: { readonly credentials: ApnsCredentials; readonly transport: ApnsTransport; readonly now: () => Instant }) {
    this.credentials = options.credentials;
    this.transport = options.transport;
    this.now = options.now;
  }

  private token(): string {
    const at = this.now();
    if (this.cached === null || at - this.cached.at > 40 * 60 * 1000) this.cached = { jwt: apnsJwt(this.credentials, at), at };
    return this.cached.jwt;
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    const host = device.environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
    try {
      const { status } = await this.transport.post(host, `/3/device/${device.token}`, {
        authorization: `bearer ${this.token()}`, "apns-topic": this.credentials.bundleID, "apns-push-type": "alert", "apns-priority": "10",
        "content-type": "application/json",
      }, apnsPayload(message));
      if (status === 200) return "sent";
      // 400 BadDeviceToken e 410 Unregistered: o aparelho não existe mais, o token deve sair.
      return status === 410 || status === 400 ? "invalidToken" : "failed";
    } catch {
      return "failed";
    }
  }
}
