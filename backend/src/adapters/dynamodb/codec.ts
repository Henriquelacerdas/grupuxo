import type {
  Absence, AppNotification, House, HouseMembership, PendingRotation, Room, RoomMembership, RoomScheduleVersion,
  RotationParticipationChange, TaskAssignment, TaskDefinition, TaskOccurrence, TaskSwapRequest, User,
} from "../../domain/entities.ts";
import {
  absenceID, houseID, houseMembershipID, notificationID, roomID, roomMembershipID, taskAssignmentID, taskDefinitionID,
  taskOccurrenceID, taskSwapRequestID, userID, type HouseID, type UserID,
} from "../../domain/ids.ts";
import {
  taskEffort, type RecurrencePolicy, type RoomCategory, type RoomColor, type RoomKind, type RoomVisibility,
  type TaskAssignmentPolicy, type TaskEffort, type TaskKind, type TaskOccurrenceStatus, type WeeklyPeriodicity,
} from "../../domain/value-objects.ts";
import type { AppNotificationKind, TaskSwapRequestStatus } from "../../domain/entities.ts";
import type { DynamoItem, DynamoValue } from "./client.ts";
import {
  META_SK, PROFILE_SK, SK_PREFIX, housePK, idFromSK, lookupPK, notificationGSISK, userPK,
} from "./keys.ts";
import {
  asRecord, asString, bool, decoding, integer, invalid, list, nullableBool, nullableList, nullableNum,
  nullableRecord, nullableStr, num, numberMap, oneOf, record, str,
} from "./reader.ts";

// Conversão entre as entidades do domínio e os itens da seção 4 do BACKEND.md. Entidades da casa não repetem o
// `houseID` (vem da partição) nem o próprio ID (vem do `SK`). Decodificação escrita à mão: nada de `as`.

const ROOM_KINDS: readonly RoomKind[] = ["wholeHouse", "standard"];
const ROOM_VISIBILITIES: readonly RoomVisibility[] = ["common", "privateRoom"];
const ROOM_CATEGORIES: readonly RoomCategory[] = [
  "kitchen", "bathroom", "bedroom", "livingRoom", "laundry", "office", "outdoor", "other",
];
const ROOM_COLORS: readonly RoomColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "brown", "gray", "pink"];
const TASK_KINDS: readonly TaskKind[] = ["recurring", "sporadic"];
const ASSIGNMENT_POLICIES: readonly TaskAssignmentPolicy[] = [
  "balancedAutomatically", "calendarRotation", "afterCompletion", "selfAssigned",
];
const OCCURRENCE_STATUSES: readonly TaskOccurrenceStatus[] = ["available", "assigned", "completed"];
const SWAP_STATUSES: readonly TaskSwapRequestStatus[] = ["pending", "accepted", "rejected"];
const NOTIFICATION_KINDS: readonly AppNotificationKind[] = ["taskSwapRequested", "taskSwapAccepted", "taskSwapRejected"];
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

/** Itens de entidades da casa carregam a `PK` da partição e o `SK` próprio. */
function base(houseId: HouseID, sk: string, attributes: Readonly<Record<string, DynamoValue>>): DynamoItem {
  return { PK: housePK(houseId), SK: sk, ...attributes };
}

function userIDs(values: readonly DynamoValue[]): UserID[] {
  return values.map((value) => userID(asString(value)));
}

// ---------- Casa ----------

export function encodeHouse(house: House, version: number): DynamoItem {
  return base(house.id, META_SK, {
    name: house.name, accessCode: house.accessCode, timezone: house.timezone, createdAt: house.createdAt, version,
  });
}

export function decodeHouse(item: DynamoItem): { readonly house: House; readonly version: number } {
  return decoding(() => ({
    house: {
      id: houseID(idFromPK(str(item, "PK"), "HOUSE#")),
      name: str(item, "name"), accessCode: str(item, "accessCode"), createdAt: num(item, "createdAt"),
      timezone: str(item, "timezone"),
    },
    version: integer(item, "version"),
  }));
}

function idFromPK(pk: string, prefix: string): string {
  return pk.startsWith(prefix) ? pk.slice(prefix.length) : invalid();
}

export function houseIDFromPK(pk: string): HouseID {
  return decoding(() => houseID(idFromPK(pk, "HOUSE#")));
}

export function houseIDFromGSISK(gsi1sk: string): HouseID {
  return decoding(() => houseID(idFromPK(gsi1sk, "HOUSE#")));
}

// ---------- Morador (global) ----------

export function encodeUser(user: User): DynamoItem {
  return { PK: userPK(user.id), SK: PROFILE_SK, name: user.name, email: user.email };
}

export function decodeUser(item: DynamoItem): User {
  return decoding(() => ({
    id: userID(idFromPK(str(item, "PK"), "USER#")), name: str(item, "name"), email: nullableStr(item, "email"),
  }));
}

// ---------- Vínculo com a casa ----------

export function encodeHouseMembership(membership: HouseMembership): DynamoItem {
  return {
    ...base(membership.houseID, `${SK_PREFIX.membership}${membership.id}`, { userID: membership.userID }),
    GSI1PK: userPK(membership.userID), GSI1SK: housePK(membership.houseID),
  };
}

export function decodeHouseMembership(item: DynamoItem, house: HouseID): HouseMembership {
  return decoding(() => ({
    id: houseMembershipID(idFromSK(str(item, "SK"), SK_PREFIX.membership)), houseID: house, userID: userID(str(item, "userID")),
  }));
}

// ---------- Cômodo ----------

function encodeScheduleVersion(version: RoomScheduleVersion): DynamoItem {
  return {
    effectiveAt: version.effectiveAt, queue: version.queue, responsibleCount: version.responsibleCount,
    taskRoles: { ...version.taskRoles }, periodIndex: version.periodIndex,
  };
}

function decodeScheduleVersion(value: DynamoValue): RoomScheduleVersion {
  const item = asRecord(value);
  return {
    effectiveAt: num(item, "effectiveAt"), queue: userIDs(list(item, "queue")),
    responsibleCount: integer(item, "responsibleCount"), taskRoles: numberMap(item, "taskRoles"),
    periodIndex: integer(item, "periodIndex"),
  };
}

export function encodeRoom(room: Room): DynamoItem {
  return {
    ...base(room.houseID, `${SK_PREFIX.room}${room.id}`, {
      name: room.name, kind: room.kind, category: room.category, visibility: room.visibility,
      executionsPerPeriod: room.periodicity.executionsPerPeriod, intervalWeeks: room.periodicity.intervalWeeks,
      responsibleCount: room.responsibleCount, calendarAnchor: room.calendarAnchor,
      scheduleVersions: room.scheduleVersions.map(encodeScheduleVersion), icon: room.icon, color: room.color,
    }),
    GSI1PK: lookupPK.room(room.id), GSI1SK: housePK(room.houseID),
  };
}

export function decodeRoom(item: DynamoItem, house: HouseID): Room {
  return decoding(() => ({
    id: roomID(idFromSK(str(item, "SK"), SK_PREFIX.room)), houseID: house, name: str(item, "name"),
    kind: oneOf(item, "kind", ROOM_KINDS), category: oneOf(item, "category", ROOM_CATEGORIES),
    visibility: oneOf(item, "visibility", ROOM_VISIBILITIES),
    periodicity: { executionsPerPeriod: integer(item, "executionsPerPeriod"), intervalWeeks: integer(item, "intervalWeeks") },
    responsibleCount: integer(item, "responsibleCount"), calendarAnchor: nullableNum(item, "calendarAnchor"),
    scheduleVersions: list(item, "scheduleVersions").map(decodeScheduleVersion),
    icon: str(item, "icon"), color: oneOf(item, "color", ROOM_COLORS),
  }));
}

// ---------- Participação no cômodo ----------

function encodeRotationChange(change: RotationParticipationChange): DynamoItem {
  return { effectiveAt: change.effectiveAt, participates: change.participates };
}

function decodeRotationChange(value: DynamoValue): RotationParticipationChange {
  const item = asRecord(value);
  return { effectiveAt: num(item, "effectiveAt"), participates: bool(item, "participates") };
}

export function encodeRoomMembership(houseId: HouseID, membership: RoomMembership): DynamoItem {
  return base(houseId, `${SK_PREFIX.roomMembership}${membership.id}`, {
    roomID: membership.roomID, userID: membership.userID, fairnessDebt: membership.fairnessDebt,
    leftAt: membership.leftAt, rotationChanges: membership.rotationChanges?.map(encodeRotationChange) ?? null,
  });
}

export function decodeRoomMembership(item: DynamoItem): RoomMembership {
  return decoding(() => ({
    id: roomMembershipID(idFromSK(str(item, "SK"), SK_PREFIX.roomMembership)), roomID: roomID(str(item, "roomID")),
    userID: userID(str(item, "userID")), fairnessDebt: num(item, "fairnessDebt"), leftAt: nullableNum(item, "leftAt"),
    rotationChanges: nullableList(item, "rotationChanges")?.map(decodeRotationChange) ?? null,
  }));
}

// ---------- Definição de tarefa ----------

function encodeRecurrence(policy: RecurrencePolicy): DynamoItem {
  switch (policy.kind) {
    case "none": return { kind: "none" };
    case "recurring": return { kind: "recurring", frequency: policy.frequency, interval: policy.interval };
    case "weekly": return {
      kind: "weekly", executionsPerPeriod: policy.periodicity.executionsPerPeriod, intervalWeeks: policy.periodicity.intervalWeeks,
    };
    default: return invalid();
  }
}

function decodeRecurrence(item: DynamoItem): RecurrencePolicy {
  const kind = oneOf(item, "kind", ["none", "recurring", "weekly"] as const);
  switch (kind) {
    case "none": return { kind: "none" };
    case "recurring": return {
      kind: "recurring", frequency: oneOf(item, "frequency", FREQUENCIES), interval: integer(item, "interval"),
    };
    case "weekly": {
      const periodicity: WeeklyPeriodicity = {
        executionsPerPeriod: integer(item, "executionsPerPeriod"), intervalWeeks: integer(item, "intervalWeeks"),
      };
      return { kind: "weekly", periodicity };
    }
    default: return invalid();
  }
}

function decodeEffort(item: DynamoItem, name: string): TaskEffort {
  const points = integer(item, name);
  return points >= 1 && points <= 3 ? taskEffort(points) : invalid();
}

function encodePendingRotation(pending: PendingRotation | null): DynamoValue {
  return pending === null ? null : { effectiveAt: pending.effectiveAt, queue: pending.queue };
}

function decodePendingRotation(item: DynamoItem | null): PendingRotation | null {
  return item === null ? null : { effectiveAt: num(item, "effectiveAt"), queue: userIDs(list(item, "queue")) };
}

export function encodeDefinition(houseId: HouseID, definition: TaskDefinition): DynamoItem {
  return base(houseId, `${SK_PREFIX.definition}${definition.id}`, {
    roomID: definition.roomID, name: definition.name, details: definition.details, effort: definition.effort.points,
    kind: definition.kind, recurrence: encodeRecurrence(definition.recurrence), assignmentPolicy: definition.assignmentPolicy,
    sourceSuggestionID: definition.sourceSuggestionID, rotationQueue: definition.rotationQueue,
    currentRotationIndex: definition.currentRotationIndex, nextScheduledAt: definition.nextScheduledAt,
    pendingRotation: encodePendingRotation(definition.pendingRotation), calendarAnchor: definition.calendarAnchor,
  });
}

export function decodeDefinition(item: DynamoItem): TaskDefinition {
  return decoding(() => ({
    id: taskDefinitionID(idFromSK(str(item, "SK"), SK_PREFIX.definition)), roomID: roomID(str(item, "roomID")),
    name: str(item, "name"), details: str(item, "details"), effort: decodeEffort(item, "effort"),
    kind: oneOf(item, "kind", TASK_KINDS), recurrence: decodeRecurrence(record(item, "recurrence")),
    assignmentPolicy: oneOf(item, "assignmentPolicy", ASSIGNMENT_POLICIES),
    sourceSuggestionID: nullableStr(item, "sourceSuggestionID"), rotationQueue: userIDs(list(item, "rotationQueue")),
    currentRotationIndex: integer(item, "currentRotationIndex"), nextScheduledAt: nullableNum(item, "nextScheduledAt"),
    pendingRotation: decodePendingRotation(nullableRecord(item, "pendingRotation")),
    calendarAnchor: nullableNum(item, "calendarAnchor"),
  }));
}

// ---------- Ocorrência ----------

export function encodeOccurrence(houseId: HouseID, occurrence: TaskOccurrence): DynamoItem {
  return {
    ...base(houseId, `${SK_PREFIX.occurrence}${occurrence.id}`, {
      taskDefinitionID: occurrence.taskDefinitionID, availableAt: occurrence.availableAt, dueAt: occurrence.dueAt,
      status: occurrence.status, completedAt: occurrence.completedAt, completedByUserID: occurrence.completedByUserID,
      completionDebtImpacts: occurrence.completionDebtImpacts === null ? null : { ...occurrence.completionDebtImpacts },
      didPublishSuccessor: occurrence.didPublishSuccessor, effortSnapshot: occurrence.effortSnapshot.points,
    }),
    GSI1PK: lookupPK.occurrence(occurrence.id), GSI1SK: housePK(houseId),
  };
}

export function decodeOccurrence(item: DynamoItem): TaskOccurrence {
  return decoding(() => {
    const completedBy = nullableStr(item, "completedByUserID");
    return {
      id: taskOccurrenceID(idFromSK(str(item, "SK"), SK_PREFIX.occurrence)),
      taskDefinitionID: taskDefinitionID(str(item, "taskDefinitionID")), availableAt: num(item, "availableAt"),
      dueAt: nullableNum(item, "dueAt"), status: oneOf(item, "status", OCCURRENCE_STATUSES),
      completedAt: nullableNum(item, "completedAt"), completedByUserID: completedBy === null ? null : userID(completedBy),
      completionDebtImpacts: nullableRecord(item, "completionDebtImpacts") === null ? null : numberMap(item, "completionDebtImpacts"),
      didPublishSuccessor: nullableBool(item, "didPublishSuccessor"), effortSnapshot: decodeEffort(item, "effortSnapshot"),
    };
  });
}

// ---------- Atribuição ----------

export function encodeAssignment(houseId: HouseID, assignment: TaskAssignment): DynamoItem {
  return base(houseId, `${SK_PREFIX.assignment}${assignment.id}`, {
    occurrenceID: assignment.occurrenceID, userID: assignment.userID, assignedAt: assignment.assignedAt,
    endedAt: assignment.endedAt, supersededAt: assignment.supersededAt,
  });
}

export function decodeAssignment(item: DynamoItem): TaskAssignment {
  return decoding(() => ({
    id: taskAssignmentID(idFromSK(str(item, "SK"), SK_PREFIX.assignment)),
    occurrenceID: taskOccurrenceID(str(item, "occurrenceID")), userID: userID(str(item, "userID")),
    assignedAt: num(item, "assignedAt"), endedAt: nullableNum(item, "endedAt"), supersededAt: nullableNum(item, "supersededAt"),
  }));
}

// ---------- Troca ----------

export function encodeSwap(houseId: HouseID, swap: TaskSwapRequest): DynamoItem {
  return {
    ...base(houseId, `${SK_PREFIX.swap}${swap.id}`, {
      requesterID: swap.requesterID, receiverID: swap.receiverID, offeredOccurrenceID: swap.offeredOccurrenceID,
      requestedOccurrenceID: swap.requestedOccurrenceID, status: swap.status, createdAt: swap.createdAt,
      resolvedAt: swap.resolvedAt,
    }),
    GSI1PK: lookupPK.swap(swap.id), GSI1SK: housePK(houseId),
  };
}

export function decodeSwap(item: DynamoItem): TaskSwapRequest {
  return decoding(() => ({
    id: taskSwapRequestID(idFromSK(str(item, "SK"), SK_PREFIX.swap)), requesterID: userID(str(item, "requesterID")),
    receiverID: userID(str(item, "receiverID")), offeredOccurrenceID: taskOccurrenceID(str(item, "offeredOccurrenceID")),
    requestedOccurrenceID: taskOccurrenceID(str(item, "requestedOccurrenceID")), status: oneOf(item, "status", SWAP_STATUSES),
    createdAt: num(item, "createdAt"), resolvedAt: nullableNum(item, "resolvedAt"),
  }));
}

// ---------- Notificação ----------

export function encodeNotification(houseId: HouseID, notification: AppNotification): DynamoItem {
  return {
    ...base(houseId, `${SK_PREFIX.notification}${notification.id}`, {
      recipientUserID: notification.recipientUserID, kind: notification.kind, swapRequestID: notification.swapRequestID,
      createdAt: notification.createdAt, readAt: notification.readAt,
    }),
    GSI1PK: userPK(notification.recipientUserID), GSI1SK: notificationGSISK(notification.createdAt, notification.id),
  };
}

export function decodeNotification(item: DynamoItem): AppNotification {
  return decoding(() => ({
    id: notificationID(idFromSK(str(item, "SK"), SK_PREFIX.notification)),
    recipientUserID: userID(str(item, "recipientUserID")), kind: oneOf(item, "kind", NOTIFICATION_KINDS),
    swapRequestID: taskSwapRequestID(str(item, "swapRequestID")), createdAt: num(item, "createdAt"),
    readAt: nullableNum(item, "readAt"),
  }));
}

/** Notificação a partir do item do `GSI1` (a `PK` é a partição da casa, o `SK` é o próprio). */
export function houseOfNotificationItem(item: DynamoItem): HouseID {
  return houseIDFromPK(str(item, "PK"));
}

// ---------- Ausência ----------

export function encodeAbsence(houseId: HouseID, absence: Absence): DynamoItem {
  return base(houseId, `${SK_PREFIX.absence}${absence.id}`, {
    membershipID: absence.membershipID, startsAt: absence.startsAt, endsAt: absence.endsAt, reason: absence.reason,
  });
}

export function decodeAbsence(item: DynamoItem): Absence {
  return decoding(() => ({
    id: absenceID(idFromSK(str(item, "SK"), SK_PREFIX.absence)), membershipID: houseMembershipID(str(item, "membershipID")),
    startsAt: num(item, "startsAt"), endsAt: num(item, "endsAt"), reason: nullableStr(item, "reason"),
  }));
}

