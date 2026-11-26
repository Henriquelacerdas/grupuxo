import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import {
  DEFAULT_PREFERENCES, deviceRef, type NotificationPreferences, type PushDevice, type PushDeviceRef, type PushDirectory,
} from "../../push/push.ts";
import type { ReminderClaims } from "../../push/daily-reminder.ts";

const sameDevice = (a: PushDeviceRef, b: PushDeviceRef): boolean =>
  a.kind === "apns" ? b.kind === "apns" && a.token === b.token : b.kind === "web" && a.endpoint === b.endpoint;

export class InMemoryPushDirectory implements PushDirectory {
  private readonly deviceList = new Map<UserID, PushDevice[]>();
  private readonly prefs = new Map<UserID, NotificationPreferences>();

  async registerDevice(userID: UserID, device: PushDevice, _at: Instant): Promise<void> {
    const ref = deviceRef(device);
    const others = (this.deviceList.get(userID) ?? []).filter((d) => !sameDevice(deviceRef(d), ref));
    this.deviceList.set(userID, [...others, device]);
  }

  async removeDevice(userID: UserID, device: PushDeviceRef): Promise<void> {
    this.deviceList.set(userID, (this.deviceList.get(userID) ?? []).filter((d) => !sameDevice(deviceRef(d), device)));
  }

  async devices(userID: UserID): Promise<readonly PushDevice[]> {
    return this.deviceList.get(userID) ?? [];
  }

  async preferences(userID: UserID): Promise<NotificationPreferences> {
    return this.prefs.get(userID) ?? DEFAULT_PREFERENCES;
  }

  async setPreferences(userID: UserID, preferences: NotificationPreferences): Promise<void> {
    this.prefs.set(userID, preferences);
  }
}

/** Um lembrete por morador e dia local (`ReminderClaims`), em memória. */
export class InMemoryReminderClaims implements ReminderClaims {
  private readonly claimed = new Set<string>();

  async claim(userID: UserID, localDay: string, _at: Instant): Promise<boolean> {
    const key = `${userID}#${localDay}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}
