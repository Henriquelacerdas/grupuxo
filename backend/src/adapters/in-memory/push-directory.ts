import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import { DEFAULT_PREFERENCES, type NotificationPreferences, type PushDevice, type PushDirectory } from "../../push/push.ts";

export class InMemoryPushDirectory implements PushDirectory {
  private readonly deviceList = new Map<UserID, PushDevice[]>();
  private readonly prefs = new Map<UserID, NotificationPreferences>();

  async registerDevice(userID: UserID, device: PushDevice, _at: Instant): Promise<void> {
    const others = (this.deviceList.get(userID) ?? []).filter((d) => d.token !== device.token);
    this.deviceList.set(userID, [...others, device]);
  }

  async removeDevice(userID: UserID, token: string): Promise<void> {
    this.deviceList.set(userID, (this.deviceList.get(userID) ?? []).filter((d) => d.token !== token));
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
