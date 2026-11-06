import type { Instant } from "../dates.ts";
import { isCurrentMember, type AppNotification, type AppNotificationKind } from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  notificationID, type HouseID, type NotificationID, type RoomID, type TaskDefinitionID, type TaskSwapRequestID, type UserID,
} from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import type { CommandContext } from "./context.ts";

/** Referências opcionais de um aviso; o que não vem fica `null`. */
export interface NotificationRefs {
  readonly swapRequestID?: TaskSwapRequestID;
  readonly taskDefinitionID?: TaskDefinitionID;
  readonly roomID?: RoomID;
  readonly actorUserID?: UserID;
  readonly subjectName?: string;
}

export function buildNotification(
  ctx: CommandContext, recipientUserID: UserID, houseID: HouseID, kind: AppNotificationKind, date: Instant,
  refs: NotificationRefs = {},
): AppNotification {
  return {
    id: notificationID(ctx.newID()), recipientUserID, houseID, kind,
    swapRequestID: refs.swapRequestID ?? null, taskDefinitionID: refs.taskDefinitionID ?? null,
    roomID: refs.roomID ?? null, actorUserID: refs.actorUserID ?? null, subjectName: refs.subjectName ?? null,
    createdAt: date, readAt: null,
  };
}

/** Moradores da casa, em ordem de ID (os avisos saem sempre na mesma ordem). */
export function houseResidentIDs(state: StoreState, houseID: HouseID): UserID[] {
  return state.houseMemberships.filter((m) => m.houseID === houseID).map((m) => m.userID).sort();
}

/**
 * Quem acompanha um cômodo: todos os moradores da casa se ele é comum, só os participantes atuais se é privado.
 * Em ordem de ID.
 */
export function roomAudienceIDs(state: StoreState, roomID: RoomID): UserID[] {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) return [];
  if (room.visibility === "common") return houseResidentIDs(state, room.houseID);
  return state.roomMemberships.filter((m) => m.roomID === roomID && isCurrentMember(m)).map((m) => m.userID).sort();
}

/** Um aviso para cada destinatário, menos `except` (quem fez a ação). */
export function notifyAll(
  ctx: CommandContext, state: StoreState, recipients: readonly UserID[], except: UserID | null, houseID: HouseID,
  kind: AppNotificationKind, date: Instant, refs: NotificationRefs = {},
): void {
  for (const recipient of recipients) {
    if (recipient === except) continue;
    state.notifications.push(buildNotification(ctx, recipient, houseID, kind, date, refs));
  }
}

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
