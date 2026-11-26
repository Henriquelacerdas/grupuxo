import {
  accessRequestsDecoder, definitionDecoder, meDecoder, myHouseDecoder, notificationsDecoder, participationDecoder, pendingRatingsDecoder,
  preferencesDecoder, ratingSummaryDecoder, roomDecoder, roomIDsDecoder, snapshotDecoder, swapDecoder, swapsDecoder, tasksDecoder,
  vacationDecoder, whatsAppLinkDecoder, whatsAppStatusDecoder,
  type NotificationPreferences, type Periodicity, type RatingLevel, type RatingTag, type Recurrence, type RoomCategory, type RoomColor,
  type RoomVisibility, type AssignmentPolicy, type TaskKind,
} from "@/lib/api/types";
import { object, field, string } from "@/lib/api/decode";
import { api, request, send } from "./http";

// Uma função por rota da `api` (docs/BACKEND.md §6.1). Caminhos com UUID em minúsculo, como no app.
const id = (value: string): string => encodeURIComponent(value.toLowerCase());

export const me = {
  get: () => api("GET", "/v1/me", meDecoder),
  register: (name: string) => api("POST", "/v1/me", meDecoder, { name }),
  rename: (name: string) => send("PATCH", "/v1/me", { name }),
  remove: () => send("DELETE", "/v1/me"),
  vacation: () => api("GET", "/v1/me/vacation", vacationDecoder),
  startVacation: () => api("PUT", "/v1/me/vacation", vacationDecoder),
  endVacation: () => api("DELETE", "/v1/me/vacation", vacationDecoder),
  preferences: () => api("GET", "/v1/me/notification-preferences", preferencesDecoder),
  setPreferences: (prefs: NotificationPreferences) => api("PUT", "/v1/me/notification-preferences", preferencesDecoder, prefs),
  removePhoto: () => send("DELETE", "/v1/me/photo"),
  whatsApp: () => api("GET", "/v1/me/whatsapp", whatsAppStatusDecoder),
  linkWhatsApp: () => api("POST", "/v1/me/whatsapp/link", whatsAppLinkDecoder),
  unlinkWhatsApp: () => send("DELETE", "/v1/me/whatsapp"),
  registerWebPush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    send("PUT", "/v1/me/devices", { kind: "web", endpoint: subscription.endpoint, keys: subscription.keys }),
  removeWebPush: (endpoint: string) => send("DELETE", `/v1/me/devices?endpoint=${encodeURIComponent(endpoint)}`),
};

export const house = {
  snapshot: () => api("GET", "/v1/me/house/snapshot", snapshotDecoder),
  mine: () => api("GET", "/v1/me/house", myHouseDecoder),
  create: (name: string, timezone: string) => api("POST", "/v1/houses", myHouseDecoder, { name, timezone }),
  join: (code: string) => api("POST", "/v1/houses/join", myHouseDecoder, { code }),
  rename: (houseID: string, name: string) => api("PATCH", `/v1/houses/${id(houseID)}`, myHouseDecoder, { name }),
  leave: (confirmRoomDeletion: boolean, confirmHouseDeletion: boolean) => {
    const query = [confirmRoomDeletion ? "confirmRoomDeletion=true" : "", confirmHouseDeletion ? "confirmHouseDeletion=true" : ""].filter(Boolean).join("&");
    return send("DELETE", `/v1/me/house${query ? `?${query}` : ""}`);
  },
  pendingRatings: () => api("GET", "/v1/me/ratings/pending", pendingRatingsDecoder),
  ratingSummary: () => api("GET", "/v1/me/ratings/summary", ratingSummaryDecoder),
  myAccessRequests: () => api("GET", "/v1/me/room-access-requests", roomIDsDecoder),
};

export interface RoomInput {
  readonly name: string;
  readonly visibility: RoomVisibility;
  readonly category: RoomCategory;
  readonly periodicity: Periodicity;
  readonly responsibleCount: number;
  readonly icon: string;
  readonly color: RoomColor;
  readonly participantIDs?: readonly string[];
}
export type RoomChanges = Partial<Pick<RoomInput, "name" | "category" | "periodicity" | "responsibleCount" | "icon" | "color">>;

export const rooms = {
  create: (houseID: string, input: RoomInput) => api("POST", `/v1/houses/${id(houseID)}/rooms`, roomDecoder, input),
  get: (roomID: string) => api("GET", `/v1/rooms/${id(roomID)}`, participationDecoder),
  update: (roomID: string, changes: RoomChanges) => api("PATCH", `/v1/rooms/${id(roomID)}`, roomDecoder, changes),
  remove: (roomID: string) => send("DELETE", `/v1/rooms/${id(roomID)}?confirmDeletion=true`),
  tasks: (roomID: string) => api("GET", `/v1/rooms/${id(roomID)}/tasks`, tasksDecoder),
  join: (roomID: string, userID: string) => send("POST", `/v1/rooms/${id(roomID)}/members`, { userID: userID.toLowerCase() }),
  leave: (roomID: string, userID: string, confirmDeletion: boolean) =>
    send("DELETE", `/v1/rooms/${id(roomID)}/members/${id(userID)}${confirmDeletion ? "?confirmDeletion=true" : ""}`),
  requestAccess: (roomID: string) => send("POST", `/v1/rooms/${id(roomID)}/access-requests`),
  cancelAccess: (roomID: string) => send("DELETE", `/v1/rooms/${id(roomID)}/access-requests`),
  accessRequests: (roomID: string) => api("GET", `/v1/rooms/${id(roomID)}/access-requests`, accessRequestsDecoder),
  approve: (roomID: string, userID: string) => send("POST", `/v1/rooms/${id(roomID)}/access-requests/${id(userID)}/approve`),
  deny: (roomID: string, userID: string) => send("POST", `/v1/rooms/${id(roomID)}/access-requests/${id(userID)}/deny`),
  rate: (roomID: string, periodStart: string, level: RatingLevel, tags: readonly RatingTag[]) =>
    send("POST", `/v1/rooms/${id(roomID)}/ratings`, { periodStart, level, tags }),
};

export interface TaskInput {
  readonly name: string;
  readonly details: string;
  readonly effort: number;
  readonly kind: TaskKind;
  readonly recurrence: Recurrence;
  readonly assignmentPolicy: AssignmentPolicy;
  readonly followsRoom?: boolean;
}
export interface TaskChanges {
  readonly name?: string;
  readonly details?: string;
  readonly effort?: number;
  readonly recurrence?: Recurrence;
  readonly followsRoom?: boolean;
}

export const tasks = {
  mine: () => api("GET", "/v1/me/tasks", tasksDecoder),
  sporadic: () => api("GET", "/v1/me/sporadic-tasks", tasksDecoder),
  create: (roomID: string, input: TaskInput) => api("POST", `/v1/rooms/${id(roomID)}/tasks`, definitionDecoder, input),
  get: (roomID: string, taskID: string) => api("GET", `/v1/rooms/${id(roomID)}/tasks/${id(taskID)}`, definitionDecoder),
  update: (roomID: string, taskID: string, changes: TaskChanges) => api("PATCH", `/v1/rooms/${id(roomID)}/tasks/${id(taskID)}`, definitionDecoder, changes),
  end: (roomID: string, taskID: string) => send("POST", `/v1/rooms/${id(roomID)}/tasks/${id(taskID)}/end`),
  remove: (roomID: string, taskID: string) => send("DELETE", `/v1/rooms/${id(roomID)}/tasks/${id(taskID)}`),
  complete: (occurrenceID: string) => send("POST", `/v1/occurrences/${id(occurrenceID)}/complete`),
  reopen: (occurrenceID: string) => send("POST", `/v1/occurrences/${id(occurrenceID)}/reopen`),
  claim: (occurrenceID: string) => send("POST", `/v1/occurrences/${id(occurrenceID)}/claim`),
  release: (occurrenceID: string) => send("POST", `/v1/occurrences/${id(occurrenceID)}/release`),
  swapCandidates: (occurrenceID: string) => api("GET", `/v1/occurrences/${id(occurrenceID)}/swap-candidates`, tasksDecoder),
};

export const swaps = {
  mine: () => api("GET", "/v1/me/swaps", swapsDecoder),
  create: (offeredOccurrenceID: string, requestedOccurrenceID: string) =>
    api("POST", "/v1/swaps", swapDecoder, { offeredOccurrenceID: offeredOccurrenceID.toLowerCase(), requestedOccurrenceID: requestedOccurrenceID.toLowerCase() }),
  accept: (swapID: string) => api("POST", `/v1/swaps/${id(swapID)}/accept`, swapDecoder),
  reject: (swapID: string) => api("POST", `/v1/swaps/${id(swapID)}/reject`, swapDecoder),
  cancel: (swapID: string) => api("POST", `/v1/swaps/${id(swapID)}/cancel`, swapDecoder),
};

export const notifications = {
  list: () => api("GET", "/v1/me/notifications", notificationsDecoder),
  read: (notificationID: string) => send("POST", `/v1/notifications/${id(notificationID)}/read`),
};

export interface SessionInfo { readonly signedIn: boolean; readonly email: string; readonly provider: string }

export const auth = {
  session: async (): Promise<SessionInfo> => {
    const payload = await request("GET", "/api/auth/session");
    const o = object(payload, "$");
    const signedIn = o["signedIn"] === true;
    return { signedIn, email: signedIn ? field(o, "email", string, "$") : "", provider: signedIn ? field(o, "provider", string, "$") : "" };
  },
  signIn: (email: string, password: string) => request("POST", "/api/auth/sign-in", { email, password }),
  signUp: async (email: string, password: string): Promise<{ confirmed: boolean }> => {
    const payload = await request("POST", "/api/auth/sign-up", { email, password });
    return { confirmed: typeof payload === "object" && payload !== null && Reflect.get(payload, "confirmed") === true };
  },
  confirm: (email: string, code: string) => request("POST", "/api/auth/confirm", { email, code }),
  resend: (email: string) => request("POST", "/api/auth/resend", { email }),
  forgot: (email: string) => request("POST", "/api/auth/forgot", { email }),
  reset: (email: string, code: string, password: string) => request("POST", "/api/auth/reset", { email, code, password }),
  changePassword: (currentPassword: string, newPassword: string) => request("POST", "/api/auth/change-password", { currentPassword, newPassword }),
  signOut: () => request("POST", "/api/auth/sign-out"),
  uploadPhoto: async (jpeg: Blob): Promise<string> => {
    const payload = await request("POST", "/api/photo", undefined, { contentType: "image/jpeg", raw: jpeg });
    return field(object(payload, "$"), "photoURL", string, "$");
  },
};
