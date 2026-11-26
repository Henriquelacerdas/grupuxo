import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import {
  DEFAULT_PREFERENCES, type NotificationPreferences, type PushDevice, type PushDeviceRef, type PushDirectory,
} from "../../push/push.ts";
import type { ReminderClaims } from "../../push/daily-reminder.ts";
import { DynamoConditionFailedError, queryAll, type DynamoClient, type DynamoItem } from "./client.ts";
import { ttlSeconds, userPK } from "./keys.ts";
import { bool, decoding, integer, invalid, oneOf, str } from "./reader.ts";

/**
 * Aparelhos e preferências do morador (BACKEND.md seção 4): APNs em `USER#<id>`/`DEVICE#<token>` (formato de antes,
 * sem `kind`), Web Push em `USER#<id>`/`DEVICE#web#<sha256(endpoint)>` com `kind: "web"`; preferências em `PREFS`.
 */
export const DEVICE_SK_PREFIX = "DEVICE#";
export const WEB_DEVICE_SK_PREFIX = "DEVICE#web#";
export const PREFS_SK = "PREFS";
export const REMINDER_SK_PREFIX = "REMINDER#";

export interface DynamoPushDirectoryOptions {
  readonly client: DynamoClient;
  /** SHA-256 hex do endpoint web (`endpointDigest` em `src/push`); injetado porque o adaptador não usa `node:*`. */
  readonly endpointDigest: (endpoint: string) => string;
}

function decodeDevice(item: DynamoItem): PushDevice {
  const kind = item["kind"];
  if (kind === undefined || kind === "apns") {
    return { kind: "apns", token: str(item, "token"), environment: oneOf(item, "environment", ["sandbox", "production"] as const) };
  }
  if (kind === "web") return { kind: "web", endpoint: str(item, "endpoint"), p256dh: str(item, "p256dh"), auth: str(item, "auth") };
  return invalid();
}

export class DynamoPushDirectory implements PushDirectory {
  private readonly client: DynamoClient;
  private readonly endpointDigest: (endpoint: string) => string;

  constructor(options: DynamoPushDirectoryOptions) {
    this.client = options.client;
    this.endpointDigest = options.endpointDigest;
  }

  private deviceSK(device: PushDeviceRef): string {
    return device.kind === "apns" ? `${DEVICE_SK_PREFIX}${device.token}` : `${WEB_DEVICE_SK_PREFIX}${this.endpointDigest(device.endpoint)}`;
  }

  async registerDevice(userID: UserID, device: PushDevice, at: Instant): Promise<void> {
    const key = { PK: userPK(userID), SK: this.deviceSK(device) };
    const item: DynamoItem = device.kind === "apns"
      ? { ...key, token: device.token, environment: device.environment, registeredAt: at }
      : { ...key, kind: "web", endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth, registeredAt: at };
    await this.client.put({ item });
  }

  async removeDevice(userID: UserID, device: PushDeviceRef): Promise<void> {
    await this.client.delete({ key: { PK: userPK(userID), SK: this.deviceSK(device) } });
  }

  async devices(userID: UserID): Promise<readonly PushDevice[]> {
    const items = await queryAll(this.client, {
      keyCondition: "#pk = :pk AND begins_with(#sk, :prefix)", names: { "#pk": "PK", "#sk": "SK" },
      values: { ":pk": userPK(userID), ":prefix": DEVICE_SK_PREFIX }, consistentRead: true, scanForward: true,
    });
    return items.map((item) => decoding(() => decodeDevice(item)));
  }

  async preferences(userID: UserID): Promise<NotificationPreferences> {
    const item = await this.client.get({ key: { PK: userPK(userID), SK: PREFS_SK }, consistentRead: true });
    if (item === undefined) return DEFAULT_PREFERENCES;
    return decoding(() => ({
      remindTasks: bool(item, "remindTasks"), reminderHour: integer(item, "reminderHour"), cycleTurned: bool(item, "cycleTurned"),
      houseActivity: bool(item, "houseActivity"), weeklySummary: bool(item, "weeklySummary"),
    }));
  }

  async setPreferences(userID: UserID, preferences: NotificationPreferences): Promise<void> {
    await this.client.put({ item: { PK: userPK(userID), SK: PREFS_SK, ...preferences } });
  }
}

/**
 * Um lembrete diário por morador e dia local: `PutItem` de `USER#<id>`/`REMINDER#<aaaa-mm-dd>` com
 * `attribute_not_exists(PK)`; condição falha = já enviado. O `ttl` só limpa (retenção sem valor padrão).
 */
export class DynamoReminderClaims implements ReminderClaims {
  private readonly client: DynamoClient;
  private readonly retentionSeconds: number;

  constructor(options: { readonly client: DynamoClient; readonly retentionSeconds: number }) {
    this.client = options.client;
    this.retentionSeconds = options.retentionSeconds;
  }

  async claim(userID: UserID, localDay: string, at: Instant): Promise<boolean> {
    try {
      await this.client.put({
        item: { PK: userPK(userID), SK: `${REMINDER_SK_PREFIX}${localDay}`, sentAt: at, ttl: ttlSeconds(at, this.retentionSeconds) },
        condition: "attribute_not_exists(PK)",
      });
      return true;
    } catch (error) {
      if (error instanceof DynamoConditionFailedError) return false;
      throw error;
    }
  }
}
