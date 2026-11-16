import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import { DEFAULT_PREFERENCES, type NotificationPreferences, type PushDevice, type PushDirectory } from "../../push/push.ts";
import { queryAll, type DynamoClient } from "./client.ts";
import { userPK } from "./keys.ts";
import { bool, decoding, integer, oneOf, str } from "./reader.ts";

/** Aparelhos (`USER#<id>`/`DEVICE#<token>`) e preferências (`USER#<id>`/`PREFS`) do morador. BACKEND.md seção 4. */
export const DEVICE_SK_PREFIX = "DEVICE#";
export const PREFS_SK = "PREFS";

export class DynamoPushDirectory implements PushDirectory {
  private readonly client: DynamoClient;

  constructor(options: { readonly client: DynamoClient }) {
    this.client = options.client;
  }

  async registerDevice(userID: UserID, device: PushDevice, at: Instant): Promise<void> {
    await this.client.put({
      item: { PK: userPK(userID), SK: `${DEVICE_SK_PREFIX}${device.token}`, token: device.token, environment: device.environment, registeredAt: at },
    });
  }

  async removeDevice(userID: UserID, token: string): Promise<void> {
    await this.client.delete({ key: { PK: userPK(userID), SK: `${DEVICE_SK_PREFIX}${token}` } });
  }

  async devices(userID: UserID): Promise<readonly PushDevice[]> {
    const items = await queryAll(this.client, {
      keyCondition: "#pk = :pk AND begins_with(#sk, :prefix)", names: { "#pk": "PK", "#sk": "SK" },
      values: { ":pk": userPK(userID), ":prefix": DEVICE_SK_PREFIX }, consistentRead: true, scanForward: true,
    });
    return items.map((item) => decoding(() => ({ token: str(item, "token"), environment: oneOf(item, "environment", ["sandbox", "production"] as const) })));
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
