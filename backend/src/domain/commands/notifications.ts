import type { Instant } from "../dates.ts";
import type { AppNotification } from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { NotificationID, UserID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";

export function notificationsFor(state: StoreState, userID: UserID): AppNotification[] {
  return state.notifications.filter((n) => n.recipientUserID === userID).sort((a, b) => b.createdAt - a.createdAt);
}

export function markNotificationAsRead(state: StoreState, notificationID: NotificationID, userID: UserID, date: Instant): void {
  const index = state.notifications.findIndex((n) => n.id === notificationID && n.recipientUserID === userID);
  const found = state.notifications[index];
  if (found === undefined) throw new DomainError("entityNotFound");
  if (found.readAt !== null) return;
  state.notifications[index] = { ...found, readAt: date };
}
