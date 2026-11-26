import type { Instant } from "../domain/dates.ts";
import type { AppNotificationKind } from "../domain/entities.ts";
import type { UserID } from "../domain/ids.ts";

// Notificações push: APNs (app iOS) e Web Push (site). O servidor manda só dados: tipo, quem fez e o nome do assunto.
// O app monta a frase no idioma do aparelho (chaves `push.<kind>` do String Catalog) e o service worker do site faz o
// mesmo com os seus textos. Nada aqui conhece AWS ou HTTP.

export type ApnsEnvironment = "sandbox" | "production";

/** Aparelho iOS. Dado gravado ou enviado sem `kind` é sempre APNs (o formato de antes do Web Push). */
export interface ApnsDevice {
  readonly kind: "apns";
  readonly token: string;
  readonly environment: ApnsEnvironment;
}

/** Inscrição de Web Push do navegador (`PushSubscription`): endpoint do serviço de push e as chaves do RFC 8291. */
export interface WebPushDevice {
  readonly kind: "web";
  /** URL `https` do serviço de push do navegador (até 1024 caracteres). */
  readonly endpoint: string;
  /** Chave pública ECDH P-256 do navegador, ponto não comprimido (65 bytes), em base64url. */
  readonly p256dh: string;
  /** Segredo de autenticação (16 bytes), em base64url. */
  readonly auth: string;
}

export type PushDevice = ApnsDevice | WebPushDevice;

/** Como identificar um aparelho para tirá-lo: o token do APNs ou o endpoint da inscrição web. */
export type PushDeviceRef = { readonly kind: "apns"; readonly token: string } | { readonly kind: "web"; readonly endpoint: string };

export function deviceRef(device: PushDevice): PushDeviceRef {
  return device.kind === "apns" ? { kind: "apns", token: device.token } : { kind: "web", endpoint: device.endpoint };
}

/** Preferências por morador (Ajustes › Notificações). Avisos diretos (troca, pedido de entrada) sempre chegam. */
export interface NotificationPreferences {
  /** "Lembrar das minhas tarefas" e o horário do lembrete diário (hora local da casa, 0 a 23). */
  readonly remindTasks: boolean;
  readonly reminderHour: number;
  readonly cycleTurned: boolean;
  /** "Atividade da casa": edições, exclusões, entradas e saídas. */
  readonly houseActivity: boolean;
  readonly weeklySummary: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  remindTasks: true, reminderHour: 9, cycleTurned: true, houseActivity: true, weeklySummary: true,
};

export function validPreferences(value: NotificationPreferences): boolean {
  return Number.isInteger(value.reminderHour) && value.reminderHour >= 0 && value.reminderHour <= 23;
}

/** Se o morador quer receber um aviso deste tipo como push. */
export function allowsPush(preferences: NotificationPreferences, kind: AppNotificationKind): boolean {
  switch (kind) {
    // Virada de ciclo: o app agenda o aviso no aparelho (lembrete local); o servidor guarda o aviso mas não manda push.
    case "cycleTurned": return false;
    case "weeklySummaryReady": return preferences.weeklySummary;
    case "taskEdited": case "taskDeleted": case "effortChanged": case "memberJoined": case "memberLeft": case "roomDeleted":
      return preferences.houseActivity;
    case "taskSwapRequested": case "taskSwapAccepted": case "taskSwapRejected":
    case "roomAccessRequested": case "roomAccessApproved": case "roomAccessDenied":
      return true;
  }
}

/**
 * Se um aviso deste tipo vai para este aparelho. APNs segue `allowsPush` sem mudança. Web acrescenta só a virada de
 * ciclo (o site não agenda lembretes locais como o iPhone), quando `cycleTurned` está ligado.
 */
export function allowsPushTo(preferences: NotificationPreferences, kind: AppNotificationKind, device: PushDevice["kind"]): boolean {
  if (allowsPush(preferences, kind)) return true;
  return device === "web" && kind === "cycleTurned" && preferences.cycleTurned;
}

/** Push de um aviso da casa (`NOTIF#`). */
export interface NotificationPushMessage {
  readonly kind: AppNotificationKind;
  readonly actorName: string | null;
  readonly subjectName: string | null;
}

/** Lembrete diário das tarefas pendentes (só Web Push: no iPhone o lembrete é local). */
export interface DailyTasksPushMessage {
  readonly kind: "dailyTasks";
  readonly count: number;
}

export type PushMessage = NotificationPushMessage | DailyTasksPushMessage;

export type PushResult = "sent" | "invalidToken" | "failed";

export interface PushSender<Device extends PushDevice = PushDevice> {
  send(device: Device, message: PushMessage): Promise<PushResult>;
}

export interface PushDirectory {
  /** Idempotente: o mesmo token (APNs) ou o mesmo endpoint (web) substitui o registro anterior. */
  registerDevice(userID: UserID, device: PushDevice, at: Instant): Promise<void>;
  /** Idempotente: aparelho que não existe não é erro. */
  removeDevice(userID: UserID, device: PushDeviceRef): Promise<void>;
  devices(userID: UserID): Promise<readonly PushDevice[]>;
  preferences(userID: UserID): Promise<NotificationPreferences>;
  setPreferences(userID: UserID, preferences: NotificationPreferences): Promise<void>;
}

/** Token do APNs: hexadecimal (64 caracteres hoje; aceita de 32 a 200 para não quebrar se o formato crescer). */
export const validDeviceToken = (token: string): boolean => /^[0-9a-fA-F]{32,200}$/.test(token);

/** Endpoint de Web Push: URL `https` absoluta, até 1024 caracteres, sem credenciais nem fragmento. */
export function validWebPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "" && url.hash === "";
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Bytes de um texto base64url sem preenchimento (aceita `=` no fim); `null` se não for base64url. */
export function base64urlBytes(text: string): Uint8Array | null {
  const unpadded = text.replace(/=+$/, "");
  if (!BASE64URL.test(unpadded) || unpadded.length % 4 === 1) return null;
  return Uint8Array.from(Buffer.from(unpadded, "base64url"));
}

/** Chave `p256dh`: ponto P-256 não comprimido (65 bytes, começa com 0x04). */
export const validP256dh = (key: string): boolean => {
  const bytes = base64urlBytes(key);
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04;
};

/** Segredo `auth`: 16 bytes. */
export const validWebPushAuth = (secret: string): boolean => base64urlBytes(secret)?.length === 16;
