import { at, uniqueMap } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import {
  isActiveAssignment, sortedByDeadline, taskItem, type AppNotification, type Room, type TaskItem, type TaskSwapRequest,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  notificationID, taskAssignmentID, taskSwapRequestID, type HouseID, type TaskOccurrenceID, type TaskSwapRequestID, type UserID,
} from "../ids.ts";
import { TaskSwapEligibilityPolicy } from "../services/eligibility.ts";
import type { StoreState } from "../store-state.ts";
import type { CommandContext } from "./context.ts";

const policy = new TaskSwapEligibilityPolicy();

/** Itens para trocas: só a atribuição ativa conta (diferente das consultas de tarefas do morador). */
function swapItems(state: StoreState): TaskItem[] {
  const definitionByID = uniqueMap(state.definitions, (d) => d.id);
  const result: TaskItem[] = [];
  for (const occurrence of state.occurrences) {
    const definition = definitionByID.get(occurrence.taskDefinitionID);
    if (definition === undefined) continue;
    const assignment = state.assignments.find((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a)) ?? null;
    const assignee = assignment === null ? null : (state.users.find((u) => u.id === assignment.userID) ?? null);
    result.push(taskItem(definition, occurrence, assignment, assignee));
  }
  return result;
}

function itemFor(state: StoreState, occurrenceID: TaskOccurrenceID): TaskItem | undefined {
  return swapItems(state).find((item) => item.occurrence.id === occurrenceID);
}

function roomOf(state: StoreState, item: TaskItem): Room | undefined {
  return state.rooms.find((r) => r.id === item.definition.roomID);
}

function belongsToHouse(state: StoreState, request: TaskSwapRequest, houseID: HouseID): boolean {
  const item = itemFor(state, request.offeredOccurrenceID);
  const room = item === undefined ? undefined : roomOf(state, item);
  return room !== undefined && room.houseID === houseID;
}

export function swapCandidates(
  state: StoreState, requesterID: UserID, offeredOccurrenceID: TaskOccurrenceID, houseID: HouseID, date: Instant,
): TaskItem[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === requesterID)) {
    throw new DomainError("taskUnavailable");
  }
  const offeredItem = itemFor(state, offeredOccurrenceID);
  const offeredRoom = offeredItem === undefined ? undefined : roomOf(state, offeredItem);
  if (offeredItem === undefined || offeredRoom === undefined || offeredRoom.houseID !== houseID) {
    throw new DomainError("entityNotFound");
  }
  if (!policy.canOffer(offeredItem, requesterID, date)) throw new DomainError("taskUnavailable");
  const candidates = swapItems(state).filter((candidate) => {
    const assignment = candidate.assignment;
    if (assignment === null || assignment.userID === requesterID || !isActiveAssignment(assignment)) return false;
    const requestedRoom = roomOf(state, candidate);
    if (requestedRoom === undefined || requestedRoom.houseID !== houseID) return false;
    return policy.canSwap(
      offeredItem, candidate, offeredRoom, requestedRoom, requesterID, assignment.userID,
      state.houseMemberships, state.roomMemberships, state.absences, date,
    );
  });
  return sortedByDeadline(candidates);
}

export function createSwapRequest(
  ctx: CommandContext, state: StoreState, requesterID: UserID, offeredOccurrenceID: TaskOccurrenceID,
  requestedOccurrenceID: TaskOccurrenceID, date: Instant,
): TaskSwapRequest {
  const offeredItem = itemFor(state, offeredOccurrenceID);
  const requestedItem = itemFor(state, requestedOccurrenceID);
  const offeredAssignment = offeredItem?.assignment ?? null;
  const requestedAssignment = requestedItem?.assignment ?? null;
  const offeredRoom = offeredItem === undefined ? undefined : roomOf(state, offeredItem);
  const requestedRoom = requestedItem === undefined ? undefined : roomOf(state, requestedItem);
  if (
    offeredItem === undefined || requestedItem === undefined || offeredAssignment === null ||
    requestedAssignment === null || offeredRoom === undefined || requestedRoom === undefined
  ) {
    throw new DomainError("entityNotFound");
  }
  const receiverID = requestedAssignment.userID;
  if (offeredRoom.houseID !== requestedRoom.houseID) throw new DomainError("taskUnavailable");
  if (!policy.canSwap(
    offeredItem, requestedItem, offeredRoom, requestedRoom, requesterID, receiverID,
    state.houseMemberships, state.roomMemberships, state.absences, date,
  )) {
    throw new DomainError("taskUnavailable");
  }
  if (offeredAssignment.userID !== requesterID) throw new DomainError("taskUnavailable");
  const alreadyExists = state.taskSwapRequests.some((r) =>
    r.requesterID === requesterID && r.receiverID === receiverID && r.offeredOccurrenceID === offeredOccurrenceID &&
    r.requestedOccurrenceID === requestedOccurrenceID && r.status === "pending"
  );
  if (alreadyExists) throw new DomainError("taskUnavailable");
  const request: TaskSwapRequest = {
    id: taskSwapRequestID(ctx.newID()), requesterID, receiverID, offeredOccurrenceID, requestedOccurrenceID,
    status: "pending", createdAt: date, resolvedAt: null,
  };
  state.taskSwapRequests.push(request);
  state.notifications.push(notification(ctx, receiverID, "taskSwapRequested", request.id, date));
  return request;
}

function notification(
  ctx: CommandContext, recipientUserID: UserID, kind: AppNotification["kind"], swapRequestID: TaskSwapRequestID, date: Instant,
): AppNotification {
  return { id: notificationID(ctx.newID()), recipientUserID, kind, swapRequestID, createdAt: date, readAt: null };
}

/** Mais recentes primeiro; empates mantêm a ordem de inserção. */
function newestFirst<T extends { readonly createdAt: Instant }>(items: T[]): T[] {
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export function incomingRequests(state: StoreState, userID: UserID, houseID: HouseID): TaskSwapRequest[] {
  return newestFirst(state.taskSwapRequests.filter((r) => r.receiverID === userID && belongsToHouse(state, r, houseID)));
}

export function outgoingRequests(state: StoreState, userID: UserID, houseID: HouseID): TaskSwapRequest[] {
  return newestFirst(state.taskSwapRequests.filter((r) => r.requesterID === userID && belongsToHouse(state, r, houseID)));
}

function pendingRequest(state: StoreState, requestID: TaskSwapRequestID, userID: UserID): { index: number; request: TaskSwapRequest } {
  const index = state.taskSwapRequests.findIndex((r) => r.id === requestID);
  const request = state.taskSwapRequests[index];
  if (request === undefined) throw new DomainError("entityNotFound");
  if (request.status !== "pending" || request.receiverID !== userID) throw new DomainError("taskUnavailable");
  return { index, request };
}

export function acceptSwapRequest(
  ctx: CommandContext, state: StoreState, requestID: TaskSwapRequestID, userID: UserID, date: Instant,
): TaskSwapRequest {
  const { index, request } = pendingRequest(state, requestID, userID);
  const offeredItem = itemFor(state, request.offeredOccurrenceID);
  const requestedItem = itemFor(state, request.requestedOccurrenceID);
  const offeredRoom = offeredItem === undefined ? undefined : roomOf(state, offeredItem);
  const requestedRoom = requestedItem === undefined ? undefined : roomOf(state, requestedItem);
  if (offeredItem === undefined || requestedItem === undefined || offeredRoom === undefined || requestedRoom === undefined) {
    throw new DomainError("entityNotFound");
  }
  if (!policy.canSwap(
    offeredItem, requestedItem, offeredRoom, requestedRoom, request.requesterID, request.receiverID,
    state.houseMemberships, state.roomMemberships, state.absences, date,
  )) {
    throw new DomainError("taskUnavailable");
  }
  const offeredIndex = state.assignments.findIndex((a) =>
    a.occurrenceID === request.offeredOccurrenceID && a.userID === request.requesterID && isActiveAssignment(a)
  );
  const requestedIndex = state.assignments.findIndex((a) =>
    a.occurrenceID === request.requestedOccurrenceID && a.userID === request.receiverID && isActiveAssignment(a)
  );
  if (offeredIndex < 0 || requestedIndex < 0) throw new DomainError("taskUnavailable");
  state.assignments[offeredIndex] = { ...at(state.assignments, offeredIndex), endedAt: date };
  state.assignments[requestedIndex] = { ...at(state.assignments, requestedIndex), endedAt: date };
  state.assignments.push({
    id: taskAssignmentID(ctx.newID()), occurrenceID: request.offeredOccurrenceID, userID: request.receiverID,
    assignedAt: date, endedAt: null, supersededAt: null,
  });
  state.assignments.push({
    id: taskAssignmentID(ctx.newID()), occurrenceID: request.requestedOccurrenceID, userID: request.requesterID,
    assignedAt: date, endedAt: null, supersededAt: null,
  });
  const updated: TaskSwapRequest = { ...request, status: "accepted", resolvedAt: date };
  state.taskSwapRequests[index] = updated;
  state.notifications.push(notification(ctx, request.requesterID, "taskSwapAccepted", request.id, date));
  return updated;
}

export function rejectSwapRequest(
  ctx: CommandContext, state: StoreState, requestID: TaskSwapRequestID, userID: UserID, date: Instant,
): TaskSwapRequest {
  const { index, request } = pendingRequest(state, requestID, userID);
  const updated: TaskSwapRequest = { ...request, status: "rejected", resolvedAt: date };
  state.taskSwapRequests[index] = updated;
  state.notifications.push(notification(ctx, request.requesterID, "taskSwapRejected", request.id, date));
  return updated;
}

