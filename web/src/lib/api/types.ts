import {
  DecodeError, array, boolean, field, instant, lenientArray, literal, literalOr, nullable, number, object, string, type Decoder,
} from "./decode";

// Tipos e decodificadores do contrato da `api` (docs/BACKEND.md §6.1, backend/src/lambdas/api-dto.ts).
// Instantes viram milissegundos (number). O teste tests/api-fixtures.test.ts decodifica todos os
// backend/test/fixtures/api/*.json: mudou o contrato, o teste do web quebra.

export const ROOM_KINDS = ["wholeHouse", "standard"] as const;
export const ROOM_VISIBILITIES = ["common", "privateRoom"] as const;
export const ROOM_CATEGORIES = ["kitchen", "bathroom", "bedroom", "livingRoom", "laundry", "office", "outdoor", "other"] as const;
export const ROOM_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown", "gray", "pink", "teal", "indigo", "cyan"] as const;
export const TASK_KINDS = ["recurring", "sporadic"] as const;
export const ASSIGNMENT_POLICIES = ["balancedAutomatically", "calendarRotation", "afterCompletion", "selfAssigned"] as const;
export const OCCURRENCE_STATUSES = ["available", "assigned", "completed"] as const;
export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export const SWAP_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
export const NOTIFICATION_KINDS = [
  "taskSwapRequested", "taskSwapAccepted", "taskSwapRejected", "taskEdited", "taskDeleted", "effortChanged",
  "memberJoined", "memberLeft", "roomDeleted", "roomAccessRequested", "roomAccessApproved", "roomAccessDenied",
  "cycleTurned", "weeklySummaryReady",
] as const;
export const RATING_LEVELS = ["needsWork", "good", "great"] as const;
export const PRAISE_TAGS = ["spotless", "tidy", "onTime", "careful"] as const;
export const IMPROVEMENT_TAGS = ["notCleaned", "messy", "halfDone", "tookTooLong"] as const;
export const RATING_TAGS = [...PRAISE_TAGS, ...IMPROVEMENT_TAGS] as const;

export type RoomKind = (typeof ROOM_KINDS)[number];
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];
export type RoomColor = (typeof ROOM_COLORS)[number];
export type TaskKind = (typeof TASK_KINDS)[number];
export type AssignmentPolicy = (typeof ASSIGNMENT_POLICIES)[number];
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];
export type Frequency = (typeof FREQUENCIES)[number];
export type SwapStatus = (typeof SWAP_STATUSES)[number];
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type RatingLevel = (typeof RATING_LEVELS)[number];
export type RatingTag = (typeof RATING_TAGS)[number];

export interface User { readonly id: string; readonly name: string; readonly photoURL: string | null }
export interface House { readonly id: string; readonly name: string; readonly accessCode: string; readonly timezone: string; readonly createdAt: number }
export interface Periodicity { readonly executionsPerPeriod: number; readonly intervalWeeks: number }
export interface Room {
  readonly id: string; readonly houseID: string; readonly name: string; readonly kind: RoomKind; readonly category: RoomCategory;
  readonly visibility: RoomVisibility; readonly periodicity: Periodicity; readonly responsibleCount: number;
  readonly calendarAnchor: number | null; readonly icon: string; readonly color: RoomColor;
}
export interface RoomParticipation {
  readonly room: Room; readonly isMember: boolean; readonly memberCount: number;
  readonly responsibleNames: readonly string[]; readonly nextResponsibleNames: readonly string[];
  readonly periodStart: number; readonly periodEnd: number;
}
export type Recurrence =
  | { readonly kind: "none" }
  | { readonly kind: "recurring"; readonly frequency: Frequency; readonly interval: number }
  | { readonly kind: "weekly"; readonly periodicity: Periodicity };
export interface TaskDefinition {
  readonly id: string; readonly roomID: string; readonly name: string; readonly details: string; readonly effort: number;
  readonly kind: TaskKind; readonly recurrence: Recurrence; readonly assignmentPolicy: AssignmentPolicy;
  readonly calendarAnchor: number | null; readonly endedAt: number | null; readonly createdByUserID: string | null; readonly followsRoom: boolean | null;
}
export interface TaskOccurrence {
  readonly id: string; readonly taskDefinitionID: string; readonly availableAt: number; readonly dueAt: number | null;
  readonly status: OccurrenceStatus; readonly completedAt: number | null; readonly completedByUserID: string | null; readonly effort: number;
}
export interface TaskAssignment { readonly id: string; readonly userID: string; readonly assignedAt: number; readonly endedAt: number | null }
export interface TaskItem {
  readonly definition: TaskDefinition; readonly occurrence: TaskOccurrence; readonly assignment: TaskAssignment | null;
  readonly assignee: User | null; readonly suggestedAssignee: User | null;
}
export interface SwapRequest {
  readonly id: string; readonly requesterID: string; readonly receiverID: string; readonly offeredOccurrenceID: string;
  readonly requestedOccurrenceID: string; readonly status: SwapStatus; readonly createdAt: number; readonly resolvedAt: number | null;
}
export interface AppNotification {
  readonly id: string; readonly kind: NotificationKind; readonly swapRequestID: string | null; readonly taskDefinitionID: string | null;
  readonly roomID: string | null; readonly actorUserID: string | null; readonly subjectName: string | null; readonly roomName: string | null;
  readonly taskName: string | null; readonly dueAt: number | null; readonly effortFrom: number | null; readonly effortTo: number | null;
  readonly names: readonly string[]; readonly createdAt: number; readonly readAt: number | null;
}
export interface MyHouse { readonly house: House; readonly members: readonly User[]; readonly rooms: readonly Room[] }
export interface HouseSnapshot {
  readonly userID: string; readonly home: MyHouse; readonly participations: readonly RoomParticipation[];
  readonly roomTasks: readonly TaskItem[]; readonly myTasks: readonly TaskItem[]; readonly sporadicTasks: readonly TaskItem[];
  readonly pendingRoomAccessIDs: readonly string[];
}
export interface PendingRating { readonly roomID: string; readonly roomName: string; readonly periodStart: number; readonly periodStartISO: string; readonly periodEnd: number; readonly windowEnd: number }
export interface RoomRatingSummary {
  readonly roomID: string; readonly roomName: string; readonly periodStart: number; readonly periodEnd: number; readonly ratingCount: number;
  readonly level: RatingLevel | null; readonly tags: readonly RatingTag[]; readonly responsibleUserIDs: readonly string[]; readonly responsibleNames: readonly string[];
}
export interface RatingSummary {
  readonly week: { readonly start: number; readonly end: number; readonly tasksDone: number; readonly tasksTotal: number };
  readonly mine: readonly RoomRatingSummary[]; readonly house: readonly RoomRatingSummary[];
  readonly upcoming: readonly { readonly roomID: string; readonly roomName: string }[];
}
export interface Vacation { readonly onVacation: boolean; readonly startsAt: number | null }
export interface NotificationPreferences {
  readonly remindTasks: boolean; readonly reminderHour: number; readonly cycleTurned: boolean; readonly houseActivity: boolean; readonly weeklySummary: boolean;
}
export type WhatsAppStatus = { readonly linked: false } | { readonly linked: true; readonly phone: string; readonly linkedAt: number };
export interface WhatsAppLink { readonly url: string; readonly expiresAt: number }
export interface PhotoUpload { readonly key: string; readonly uploadURL: string; readonly headers: Readonly<Record<string, string>>; readonly expiresAt: number }
export interface Swaps { readonly incoming: readonly SwapRequest[]; readonly outgoing: readonly SwapRequest[] }
export interface AccessRequest { readonly userID: string; readonly requestedAt: number }

const ids = array(string);

export const userDecoder: Decoder<User> = (value, path) => {
  const o = object(value, path);
  return { id: field(o, "id", string, path), name: field(o, "name", string, path), photoURL: field(o, "photoURL", nullable(string), path) };
};

export const houseDecoder: Decoder<House> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), name: field(o, "name", string, path), accessCode: field(o, "accessCode", string, path),
    timezone: field(o, "timezone", string, path), createdAt: field(o, "createdAt", instant, path),
  };
};

const periodicityDecoder: Decoder<Periodicity> = (value, path) => {
  const o = object(value, path);
  return { executionsPerPeriod: field(o, "executionsPerPeriod", number, path), intervalWeeks: field(o, "intervalWeeks", number, path) };
};

export const roomDecoder: Decoder<Room> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), houseID: field(o, "houseID", string, path), name: field(o, "name", string, path),
    kind: field(o, "kind", literalOr(ROOM_KINDS, "standard"), path), category: field(o, "category", literalOr(ROOM_CATEGORIES, "other"), path),
    visibility: field(o, "visibility", literal(ROOM_VISIBILITIES), path), periodicity: field(o, "periodicity", periodicityDecoder, path),
    responsibleCount: field(o, "responsibleCount", number, path), calendarAnchor: field(o, "calendarAnchor", nullable(instant), path),
    icon: field(o, "icon", string, path), color: field(o, "color", literalOr(ROOM_COLORS, "blue"), path),
  };
};

export const participationDecoder: Decoder<RoomParticipation> = (value, path) => {
  const o = object(value, path);
  return {
    room: field(o, "room", roomDecoder, path), isMember: field(o, "isMember", boolean, path), memberCount: field(o, "memberCount", number, path),
    responsibleNames: field(o, "responsibleNames", array(string), path), nextResponsibleNames: field(o, "nextResponsibleNames", array(string), path),
    periodStart: field(o, "periodStart", instant, path), periodEnd: field(o, "periodEnd", instant, path),
  };
};

export const recurrenceDecoder: Decoder<Recurrence> = (value, path) => {
  const o = object(value, path);
  const kind = field(o, "kind", literal(["none", "recurring", "weekly"]), path);
  if (kind === "none") return { kind };
  if (kind === "recurring") return { kind, frequency: field(o, "frequency", literal(FREQUENCIES), path), interval: field(o, "interval", number, path) };
  return { kind, periodicity: field(o, "periodicity", periodicityDecoder, path) };
};

export const definitionDecoder: Decoder<TaskDefinition> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), roomID: field(o, "roomID", string, path), name: field(o, "name", string, path),
    details: field(o, "details", string, path), effort: field(o, "effort", number, path), kind: field(o, "kind", literal(TASK_KINDS), path),
    recurrence: field(o, "recurrence", recurrenceDecoder, path), assignmentPolicy: field(o, "assignmentPolicy", literal(ASSIGNMENT_POLICIES), path),
    calendarAnchor: field(o, "calendarAnchor", nullable(instant), path), endedAt: field(o, "endedAt", nullable(instant), path),
    createdByUserID: field(o, "createdByUserID", nullable(string), path), followsRoom: field(o, "followsRoom", nullable(boolean), path),
  };
};

const occurrenceDecoder: Decoder<TaskOccurrence> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), taskDefinitionID: field(o, "taskDefinitionID", string, path), availableAt: field(o, "availableAt", instant, path),
    dueAt: field(o, "dueAt", nullable(instant), path), status: field(o, "status", literal(OCCURRENCE_STATUSES), path),
    completedAt: field(o, "completedAt", nullable(instant), path), completedByUserID: field(o, "completedByUserID", nullable(string), path),
    effort: field(o, "effort", number, path),
  };
};

const assignmentDecoder: Decoder<TaskAssignment> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), userID: field(o, "userID", string, path),
    assignedAt: field(o, "assignedAt", instant, path), endedAt: field(o, "endedAt", nullable(instant), path),
  };
};

export const taskItemDecoder: Decoder<TaskItem> = (value, path) => {
  const o = object(value, path);
  return {
    definition: field(o, "definition", definitionDecoder, path), occurrence: field(o, "occurrence", occurrenceDecoder, path),
    assignment: field(o, "assignment", nullable(assignmentDecoder), path), assignee: field(o, "assignee", nullable(userDecoder), path),
    suggestedAssignee: field(o, "suggestedAssignee", nullable(userDecoder), path),
  };
};

export const swapDecoder: Decoder<SwapRequest> = (value, path) => {
  const o = object(value, path);
  return {
    id: field(o, "id", string, path), requesterID: field(o, "requesterID", string, path), receiverID: field(o, "receiverID", string, path),
    offeredOccurrenceID: field(o, "offeredOccurrenceID", string, path), requestedOccurrenceID: field(o, "requestedOccurrenceID", string, path),
    status: field(o, "status", literal(SWAP_STATUSES), path), createdAt: field(o, "createdAt", instant, path), resolvedAt: field(o, "resolvedAt", nullable(instant), path),
  };
};

export const notificationDecoder: Decoder<AppNotification> = (value, path) => {
  const o = object(value, path);
  const text = nullable(string);
  return {
    id: field(o, "id", string, path), kind: field(o, "kind", literal(NOTIFICATION_KINDS), path),
    swapRequestID: field(o, "swapRequestID", text, path), taskDefinitionID: field(o, "taskDefinitionID", text, path),
    roomID: field(o, "roomID", text, path), actorUserID: field(o, "actorUserID", text, path), subjectName: field(o, "subjectName", text, path),
    roomName: field(o, "roomName", text, path), taskName: field(o, "taskName", text, path), dueAt: field(o, "dueAt", nullable(instant), path),
    effortFrom: field(o, "effortFrom", nullable(number), path), effortTo: field(o, "effortTo", nullable(number), path),
    names: field(o, "names", array(string), path), createdAt: field(o, "createdAt", instant, path), readAt: field(o, "readAt", nullable(instant), path),
  };
};

export const myHouseDecoder: Decoder<MyHouse> = (value, path) => {
  const o = object(value, path);
  return { house: field(o, "house", houseDecoder, path), members: field(o, "members", array(userDecoder), path), rooms: field(o, "rooms", array(roomDecoder), path) };
};

export const snapshotDecoder: Decoder<HouseSnapshot> = (value, path) => {
  const o = object(value, path);
  const tasks = array(taskItemDecoder);
  return {
    userID: field(o, "userID", string, path), home: field(o, "home", myHouseDecoder, path),
    participations: field(o, "participations", array(participationDecoder), path), roomTasks: field(o, "roomTasks", tasks, path),
    myTasks: field(o, "myTasks", tasks, path), sporadicTasks: field(o, "sporadicTasks", tasks, path),
    pendingRoomAccessIDs: field(o, "pendingRoomAccessIDs", ids, path),
  };
};

export const tasksDecoder: Decoder<readonly TaskItem[]> = (value, path) => field(object(value, path), "tasks", array(taskItemDecoder), path);
export const notificationsDecoder: Decoder<readonly AppNotification[]> = (value, path) => field(object(value, path), "notifications", lenientArray(notificationDecoder), path);
export const swapsDecoder: Decoder<Swaps> = (value, path) => {
  const o = object(value, path);
  return { incoming: field(o, "incoming", array(swapDecoder), path), outgoing: field(o, "outgoing", array(swapDecoder), path) };
};
export const meDecoder: Decoder<{ readonly id: string }> = (value, path) => ({ id: field(object(value, path), "id", string, path) });
export const roomIDsDecoder: Decoder<readonly string[]> = (value, path) => field(object(value, path), "roomIDs", ids, path);
export const accessRequestsDecoder: Decoder<readonly AccessRequest[]> = (value, path) =>
  field(object(value, path), "requests", array((v, p) => {
    const o = object(v, p);
    return { userID: field(o, "userID", string, p), requestedAt: field(o, "requestedAt", instant, p) };
  }), path);

export const pendingRatingsDecoder: Decoder<readonly PendingRating[]> = (value, path) =>
  field(object(value, path), "pending", array((v, p) => {
    const o = object(v, p);
    return {
      roomID: field(o, "roomID", string, p), roomName: field(o, "roomName", string, p),
      periodStart: field(o, "periodStart", instant, p), periodStartISO: field(o, "periodStart", string, p),
      periodEnd: field(o, "periodEnd", instant, p), windowEnd: field(o, "windowEnd", instant, p),
    };
  }), path);

const roomSummaryDecoder: Decoder<RoomRatingSummary> = (value, path) => {
  const o = object(value, path);
  return {
    roomID: field(o, "roomID", string, path), roomName: field(o, "roomName", string, path), periodStart: field(o, "periodStart", instant, path),
    periodEnd: field(o, "periodEnd", instant, path), ratingCount: field(o, "ratingCount", number, path),
    level: field(o, "level", nullable(literal(RATING_LEVELS)), path), tags: field(o, "tags", lenientArray(literal(RATING_TAGS)), path),
    responsibleUserIDs: field(o, "responsibleUserIDs", ids, path), responsibleNames: field(o, "responsibleNames", array(string), path),
  };
};

export const ratingSummaryDecoder: Decoder<RatingSummary> = (value, path) => {
  const o = object(value, path);
  const week = object(o["week"], `${path}.week`);
  return {
    week: {
      start: field(week, "start", instant, `${path}.week`), end: field(week, "end", instant, `${path}.week`),
      tasksDone: field(week, "tasksDone", number, `${path}.week`), tasksTotal: field(week, "tasksTotal", number, `${path}.week`),
    },
    mine: field(o, "mine", array(roomSummaryDecoder), path), house: field(o, "house", array(roomSummaryDecoder), path),
    upcoming: field(o, "upcoming", array((v, p) => {
      const u = object(v, p);
      return { roomID: field(u, "roomID", string, p), roomName: field(u, "roomName", string, p) };
    }), path),
  };
};

export const vacationDecoder: Decoder<Vacation> = (value, path) => {
  const o = object(value, path);
  return { onVacation: field(o, "onVacation", boolean, path), startsAt: field(o, "startsAt", nullable(instant), path) };
};

export const preferencesDecoder: Decoder<NotificationPreferences> = (value, path) => {
  const o = object(value, path);
  return {
    remindTasks: field(o, "remindTasks", boolean, path), reminderHour: field(o, "reminderHour", number, path), cycleTurned: field(o, "cycleTurned", boolean, path),
    houseActivity: field(o, "houseActivity", boolean, path), weeklySummary: field(o, "weeklySummary", boolean, path),
  };
};

export const whatsAppStatusDecoder: Decoder<WhatsAppStatus> = (value, path) => {
  const o = object(value, path);
  if (!field(o, "linked", boolean, path)) return { linked: false };
  return { linked: true, phone: field(o, "phone", string, path), linkedAt: field(o, "linkedAt", instant, path) };
};

export const whatsAppLinkDecoder: Decoder<WhatsAppLink> = (value, path) => {
  const o = object(value, path);
  const url = field(o, "url", string, path);
  // O link vira `href`: só https, nunca `javascript:` ou outro esquema.
  if (!url.startsWith("https://")) throw new DecodeError(`${path}.url`, "https URL");
  return { url, expiresAt: field(o, "expiresAt", instant, path) };
};

export const photoUploadDecoder: Decoder<PhotoUpload> = (value, path) => {
  const o = object(value, path);
  const headers = object(o["headers"], `${path}.headers`);
  const out: Record<string, string> = {};
  for (const [name, header] of Object.entries(headers)) out[name] = string(header, `${path}.headers.${name}`);
  return { key: field(o, "key", string, path), uploadURL: field(o, "uploadURL", string, path), headers: out, expiresAt: field(o, "expiresAt", instant, path) };
};

export const photoURLDecoder: Decoder<string> = (value, path) => field(object(value, path), "photoURL", string, path);
