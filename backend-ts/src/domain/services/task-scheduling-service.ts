import { at, isBlank, lastIndexWhere, lastWhere } from "../arrays.ts";
import type { Calendar, Instant } from "../dates.ts";
import {
  cloneSchedulingState, isActiveAssignment, isCompleted, isCurrentMember, participatesAt, representsWholeHouse,
  type Room, type RoomMembership, type RoomScheduleVersion, type SchedulingState, type TaskAssignment,
  type TaskDefinition, type TaskOccurrence,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import {
  compareIDs, lookup, roomMembershipID, sortedIDs, taskAssignmentID, taskOccurrenceID,
  type HouseID, type IDGenerator, type Mutable, type RoomID, type TaskDefinitionID, type TaskOccurrenceID, type UserID,
} from "../ids.ts";
import {
  hasValidInterval, isRepeating, isValidPeriodicity, samePeriodicity, sameRecurrence, weeklyPeriodicityOf,
} from "../value-objects.ts";
import { DISTANT_PAST } from "../dates.ts";
import { FairnessCalculator } from "./fairness.ts";
import { HouseQueueOptimizer, type QueueForecast, type QueueTurn } from "./house-queue-optimizer.ts";
import { RotationCalculator } from "./rotation.ts";
import {
  addEffort, emptyWeeks, HORIZON_WEEKS, TaskDistributionEngine, type ProjectedWeek,
} from "./task-distribution-engine.ts";

export type DefinitionDraft = Mutable<TaskDefinition>;

export interface SchedulingServiceOptions {
  /** Calendário do fuso da casa (semana começa na segunda-feira). */
  readonly calendar: Calendar;
  /** Gerador de IDs de ocorrências e atribuições (injetado: o domínio não conhece `crypto`). */
  readonly newID: IDGenerator;
  readonly distribution?: TaskDistributionEngine;
  readonly fairness?: FairnessCalculator;
  readonly rotation?: RotationCalculator;
}

/**
 * Transições síncronas de agendamento sobre um `SchedulingState`. Rodam dentro da transação do repositório
 * (cópia + commit + rollback): quem chama passa uma cópia do estado e só a publica se nada lançar erro.
 * Port de `TaskSchedulingService.swift` e `RoomScheduling.swift`; a ordem das operações é a do original.
 */
export class TaskSchedulingService {
  readonly calendar: Calendar;
  readonly distribution: TaskDistributionEngine;
  readonly fairness: FairnessCalculator;
  readonly rotation: RotationCalculator;
  private readonly newID: IDGenerator;

  constructor(options: SchedulingServiceOptions) {
    this.calendar = options.calendar;
    this.newID = options.newID;
    this.distribution = options.distribution ?? new TaskDistributionEngine();
    this.fairness = options.fairness ?? new FairnessCalculator();
    this.rotation = options.rotation ?? new RotationCalculator();
  }

  // MARK: Comandos

  create(input: TaskDefinition, date: Instant, state: SchedulingState): TaskDefinition {
    const existing = state.definitions.find((d) => d.id === input.id);
    if (existing !== undefined) return existing;
    if (isBlank(input.name)) throw new DomainError("invalidTaskName");
    const target = this.room(input, state);
    this.initializeRooms(target.houseID, date, state);
    const definition: DefinitionDraft = { ...input };
    const linked = this.isRoomLinked(definition, state);
    if (linked) definition.calendarAnchor = this.room(definition, state).calendarAnchor;
    else if (definition.recurrence.kind === "weekly") definition.calendarAnchor = this.weekStart(date);
    definition.rotationQueue = [];
    definition.currentRotationIndex = 0;
    definition.nextScheduledAt = null;
    definition.pendingRotation = null;
    if (definition.kind === "sporadic") {
      if (definition.recurrence.kind !== "none" || definition.assignmentPolicy !== "selfAssigned") {
        throw new DomainError("invalidSchedule");
      }
      this.appendOccurrence(definition, date, null, null, state);
    } else {
      if (definition.assignmentPolicy === "selfAssigned") throw new DomainError("invalidSchedule");
      if (definition.assignmentPolicy === "afterCompletion") {
        definition.recurrence = { kind: "none" };
      } else if (!isRepeating(definition.recurrence) || !hasValidInterval(definition.recurrence)) {
        throw new DomainError("invalidSchedule");
      }
      const participants = this.members(definition, date, state, { includeAbsent: true });
      const start = this.weekStart(date);
      const firstDate = definition.calendarAnchor !== null && weeklyPeriodicityOf(definition.recurrence) !== null
        ? this.firstWeeklyDate(date, definition)
        : date;
      const dates = definition.assignmentPolicy === "afterCompletion"
        ? [date]
        : this.scheduledDates(firstDate, definition, this.addingWeeks(HORIZON_WEEKS, start));
      definition.rotationQueue = linked ? [] : this.distribution.generateInitialQueue(
        definition.effort.points, participants, dates.map((d) => this.weekIndex(d, start)),
        this.projection(this.room(definition, state).houseID, start, state),
        this.debts(definition.roomID, state),
      );
      if (definition.assignmentPolicy === "afterCompletion") {
        this.publish(definition, date, null, state);
      } else {
        definition.nextScheduledAt = definition.calendarAnchor !== null
          ? this.firstWeeklyDate(date, definition)
          : date;
        if (linked) {
          state.definitions.push({ ...definition });
          this.configureRoom(definition.roomID, date, state);
          state.definitions = state.definitions.filter((d) => d.id !== definition.id);
        }
        this.extend(definition, this.addingWeeks(HORIZON_WEEKS, start), state);
      }
    }
    state.definitions.push({ ...definition });
    const houseID = this.room(definition, state).houseID;
    const roomIDs = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
    if (linked) this.rebalance(houseID, date, date, state);
    const pendingBoundaries = state.roomMemberships
      .filter((m) => roomIDs.has(m.roomID))
      .flatMap((m) => m.rotationChanges ?? [])
      .map((c) => c.effectiveAt)
      .filter((t) => t > date);
    if (pendingBoundaries.length > 0) this.rebalance(houseID, Math.min(...pendingBoundaries), date, state);
    const created = state.definitions.find((d) => d.id === definition.id);
    if (created === undefined) throw new DomainError("entityNotFound");
    return created;
  }

  complete(occurrenceID: TaskOccurrenceID, userID: UserID, date: Instant, state: SchedulingState): void {
    const index = state.occurrences.findIndex((o) => o.id === occurrenceID);
    const occurrence = state.occurrences[index];
    const definitionIndex = occurrence === undefined
      ? -1
      : state.definitions.findIndex((d) => d.id === occurrence.taskDefinitionID);
    if (occurrence === undefined || definitionIndex < 0) throw new DomainError("entityNotFound");
    if (isCompleted(occurrence)) {
      if (occurrence.completedByUserID !== userID) throw new DomainError("taskUnavailable");
      return;
    }
    const definition: DefinitionDraft = { ...at(state.definitions, definitionIndex) };
    const eligible = this.members(definition, date, state, { useCurrentMembership: definition.kind === "sporadic" });
    const houseID = this.room(definition, state).houseID;
    const houseMember = state.houseMemberships.find((m) => m.houseID === houseID && m.userID === userID);
    const absent = state.absences.some((a) =>
      houseMember !== undefined && a.membershipID === houseMember.id && a.startsAt <= date && date < a.endsAt
    );
    const retained = state.roomMemberships.some((m) =>
      m.roomID === definition.roomID && m.userID === userID &&
      (m.rotationChanges ?? []).some((c) => !c.participates && c.effectiveAt > occurrence.availableAt) &&
      m.rotationChanges !== null
    );
    const allowed = occurrence.availableAt <= date && houseMember !== undefined && !absent &&
      (eligible.includes(userID) || retained) &&
      state.assignments.some((a) =>
        a.occurrenceID === occurrenceID && isActiveAssignment(a) && a.userID === userID && a.assignedAt <= date
      );
    if (!allowed) throw new DomainError("taskUnavailable");
    if (!eligible.includes(userID)) eligible.push(userID);
    this.debts(definition.roomID, state);
    const impacts = this.fairness.calculateDebtImpact(occurrence.effortSnapshot.points, userID, eligible);
    for (let i = 0; i < state.roomMemberships.length; i++) {
      const membership = at(state.roomMemberships, i);
      if (membership.roomID !== definition.roomID) continue;
      const updated = membership.fairnessDebt + (lookup(impacts, membership.userID) ?? 0);
      if (!Number.isFinite(updated)) throw new DomainError("invalidDistribution");
      state.roomMemberships[i] = { ...membership, fairnessDebt: updated };
    }
    state.occurrences[index] = {
      ...occurrence, completionDebtImpacts: impacts, status: "completed", completedAt: date, completedByUserID: userID,
    };
    for (let i = 0; i < state.assignments.length; i++) {
      const assignment = at(state.assignments, i);
      if (assignment.occurrenceID === occurrenceID && isActiveAssignment(assignment)) {
        state.assignments[i] = { ...assignment, endedAt: date };
      }
    }
    if (definition.kind === "recurring" && definition.assignmentPolicy === "afterCompletion" &&
      occurrence.didPublishSuccessor !== true) {
      this.activatePending(definition, date);
      // Definições legadas não têm fila: estabelece-a uma vez, preservando a vez de quem executou.
      if (definition.rotationQueue.length === 0) {
        definition.rotationQueue = this.members(definition, date, state, { includeAbsent: true });
        const current = definition.rotationQueue.indexOf(userID);
        definition.currentRotationIndex = current >= 0 ? this.rotation.advance(current, definition.rotationQueue) : 0;
      }
      this.publish(definition, date, null, state);
      state.occurrences[index] = { ...at(state.occurrences, index), didPublishSuccessor: true };
      state.definitions[definitionIndex] = { ...definition };
    }
  }

  reopen(occurrenceID: TaskOccurrenceID, userID: UserID, state: SchedulingState): void {
    const index = state.occurrences.findIndex((o) => o.id === occurrenceID);
    const occurrence = state.occurrences[index];
    const definition = occurrence === undefined
      ? undefined
      : state.definitions.find((d) => d.id === occurrence.taskDefinitionID);
    if (occurrence === undefined || definition === undefined) throw new DomainError("entityNotFound");
    const houseID = this.room(definition, state).houseID;
    const assignmentIndex = lastIndexWhere(state.assignments, (a) =>
      a.occurrenceID === occurrenceID && a.userID === userID && a.supersededAt === null && a.endedAt === occurrence.completedAt
    );
    if (
      !isCompleted(occurrence) || occurrence.completedByUserID !== userID ||
      !state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID) || assignmentIndex < 0
    ) {
      throw new DomainError("taskUnavailable");
    }
    // Reverte o impacto registrado, mesmo que a participação no cômodo tenha mudado desde a conclusão.
    for (let i = 0; i < state.roomMemberships.length; i++) {
      const membership = at(state.roomMemberships, i);
      if (membership.roomID === definition.roomID) {
        const impact = occurrence.completionDebtImpacts === null ? 0 : (lookup(occurrence.completionDebtImpacts, membership.userID) ?? 0);
        state.roomMemberships[i] = { ...membership, fairnessDebt: membership.fairnessDebt - impact };
      }
    }
    state.occurrences[index] = {
      ...occurrence, status: "assigned", completedAt: null, completedByUserID: null, completionDebtImpacts: null,
    };
    state.assignments[assignmentIndex] = { ...at(state.assignments, assignmentIndex), endedAt: null };
    // Os turnos já publicados permanecem; concluir de novo não publica outra sucessora.
  }

  /** Estende as escalas publicadas sem concluir, rotacionar nem editar ocorrências antigas. */
  refresh(houseID: HouseID, date: Instant, state: SchedulingState): void {
    this.initializeRooms(houseID, date, state);
    const end = this.addingWeeks(HORIZON_WEEKS, this.weekStart(date));
    const roomIDs = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
    const count = state.definitions.length;
    for (let i = 0; i < count; i++) {
      const current = at(state.definitions, i);
      if (!roomIDs.has(current.roomID)) continue;
      const definition: DefinitionDraft = { ...current };
      if (definition.kind === "recurring" && definition.assignmentPolicy === "afterCompletion") {
        this.activatePending(definition, date);
        if (definition.rotationQueue.length > 0) {
          const j = state.occurrences.findIndex((o) =>
            o.taskDefinitionID === definition.id && !isCompleted(o) &&
            !state.assignments.some((a) => a.occurrenceID === o.id && isActiveAssignment(a))
          );
          if (j >= 0) {
            const user = definition.rotationQueue[definition.currentRotationIndex];
            if (user === undefined) throw new DomainError("invalidDistribution");
            if (this.members(definition, date, state).includes(user)) {
              this.replaceAssignment(j, user, date, state);
              definition.currentRotationIndex = this.rotation.advance(definition.currentRotationIndex, definition.rotationQueue);
            }
          }
        }
        state.definitions[i] = { ...definition };
        continue;
      }
      if (definition.kind !== "recurring" || definition.assignmentPolicy === "afterCompletion" ||
        definition.nextScheduledAt === null) continue;
      this.extend(definition, end, state);
      state.definitions[i] = { ...definition };
    }
  }

  addMember(userID: UserID, roomID: RoomID, date: Instant, state: SchedulingState, options: { replan?: boolean } = {}): void {
    this.changeMember(userID, roomID, true, date, state, { replan: options.replan ?? true });
  }

  removeMember(
    userID: UserID, roomID: RoomID, date: Instant, state: SchedulingState,
    options: { confirmDeletion?: boolean; houseChange?: boolean; replan?: boolean } = {},
  ): void {
    this.changeMember(userID, roomID, false, date, state, {
      confirmDeletion: options.confirmDeletion ?? false,
      houseChange: options.houseChange ?? false,
      replan: options.replan ?? true,
    });
  }

  changeMember(
    userID: UserID, roomID: RoomID, joining: boolean, date: Instant, state: SchedulingState,
    options: { confirmDeletion?: boolean; houseChange?: boolean; replan?: boolean } = {},
  ): void {
    const confirmDeletion = options.confirmDeletion ?? false;
    const houseChange = options.houseChange ?? false;
    const replan = options.replan ?? true;
    const room = state.rooms.find((r) => r.id === roomID);
    if (room === undefined || !state.houseMemberships.some((m) => m.houseID === room.houseID && m.userID === userID)) {
      throw new DomainError("entityNotFound");
    }
    this.debts(roomID, state);
    const existing = state.roomMemberships.findIndex((m) => m.roomID === roomID && m.userID === userID);
    if (existing >= 0 && isCurrentMember(at(state.roomMemberships, existing)) === joining) return;
    if (existing < 0 && !joining) return;
    if (!joining) {
      if (!houseChange && representsWholeHouse(room)) throw new DomainError("wholeHouseProtected");
      const count = state.roomMemberships.filter((m) => m.roomID === roomID && isCurrentMember(m)).length;
      if (count === 1 && !representsWholeHouse(room)) {
        if (!confirmDeletion) throw new DomainError("deletionConfirmationRequired");
        this.deleteRoom(roomID, state);
        if (replan) this.rebalance(room.houseID, this.addingWeeks(1, this.weekStart(date)), date, state);
        return;
      }
    }
    // Materializa o calendário antigo antes de mudar a participação, inclusive semanas perdidas.
    this.refresh(room.houseID, date, state);
    const boundary = this.addingWeeks(1, this.weekStart(date));
    let index: number;
    if (existing >= 0) {
      index = existing;
    } else {
      index = state.roomMemberships.length;
      state.roomMemberships.push({
        id: roomMembershipID(this.newID()), roomID, userID, fairnessDebt: 0, leftAt: null,
        rotationChanges: [{ effectiveAt: DISTANT_PAST, participates: false }],
      });
    }
    const membership = at(state.roomMemberships, index);
    const changes = (membership.rotationChanges ?? []).filter((c) => c.effectiveAt < boundary);
    changes.push({ effectiveAt: boundary, participates: joining });
    state.roomMemberships[index] = { ...membership, leftAt: joining ? null : date, rotationChanges: changes };
    if (!joining && !houseChange) {
      const i = state.rooms.findIndex((r) => r.id === roomID);
      if (i >= 0) state.rooms[i] = { ...at(state.rooms, i), visibility: "privateRoom" };
    }
    if (replan) this.rebalance(room.houseID, boundary, date, state);
  }

  /** Replaneja execuções futuras existentes, mantendo identidade e snapshot de esforço. */
  rebalance(houseID: HouseID, boundary: Instant, date: Instant, state: SchedulingState): void {
    const roomIDs = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
    const forecastStart = this.weekStart(boundary);
    const end = this.addingWeeks(HORIZON_WEEKS, forecastStart);
    const indices: number[] = [];
    state.definitions.forEach((d, i) => {
      if (roomIDs.has(d.roomID) && d.kind === "recurring" && d.assignmentPolicy !== "selfAssigned") indices.push(i);
    });
    indices.sort((a, b) => compareIDs(at(state.definitions, a).id, at(state.definitions, b).id));
    const calendarIndices: number[] = [];
    const forecasts: QueueForecast[] = [];
    const occurrenceIndices: number[][] = [];
    this.initializeRooms(houseID, date, state);
    for (const id of sortedIDs(roomIDs)) this.configureRoom(id, boundary, state);
    for (const i of indices) {
      const definition: DefinitionDraft = { ...at(state.definitions, i) };
      if (this.isRoomLinked(definition, state)) {
        if (definition.nextScheduledAt === null) {
          definition.calendarAnchor = this.room(definition, state).calendarAnchor;
          definition.nextScheduledAt = this.firstWeeklyDate(boundary, definition);
        }
        this.extend(definition, end, state);
        definition.rotationQueue = [];
        state.definitions[i] = { ...definition };
        continue;
      }
      const participants = this.members(definition, boundary, state, { includeAbsent: true });
      if (definition.assignmentPolicy === "afterCompletion") {
        this.activatePending(definition, date);
        const old = this.normalizedQueue(definition);
        const queue = [...old.filter((u) => participants.includes(u)), ...participants.filter((u) => !old.includes(u))];
        definition.pendingRotation = { effectiveAt: boundary, queue };
        state.definitions[i] = { ...definition };
        continue;
      }
      if (definition.nextScheduledAt === null) {
        const available = state.occurrences.filter((o) => o.taskDefinitionID === definition.id).map((o) => o.availableAt);
        if (available.length > 0) {
          definition.nextScheduledAt = this.nextDate(Math.max(...available), definition);
        } else {
          definition.nextScheduledAt = boundary;
        }
        definition.rotationQueue = this.members(definition, date, state, { includeAbsent: true });
        definition.currentRotationIndex = 0;
      }
      this.extend(definition, end, state);
      const occurrences: number[] = [];
      state.occurrences.forEach((o, j) => {
        if (o.taskDefinitionID === definition.id && !isCompleted(o) && o.availableAt >= boundary) occurrences.push(j);
      });
      occurrences.sort((a, b) => at(state.occurrences, a).availableAt - at(state.occurrences, b).availableAt);
      // Desfaz os turnos futuros publicados para recuperar a fase na fronteira.
      const phase: DefinitionDraft = { ...definition };
      if (phase.rotationQueue.length > 0) {
        const n = phase.rotationQueue.length;
        phase.currentRotationIndex = (phase.currentRotationIndex - (occurrences.length % n) + n) % n;
      }
      const turns: QueueTurn[] = occurrences
        .filter((j) => at(state.occurrences, j).availableAt < end)
        .map((j) => {
          const occurrence = at(state.occurrences, j);
          return {
            week: this.weekIndex(occurrence.availableAt, forecastStart),
            effort: occurrence.effortSnapshot.points,
            eligible: new Set(this.members(definition, occurrence.availableAt, state)),
            incumbent: state.assignments.find((a) => a.occurrenceID === occurrence.id && isActiveAssignment(a))?.userID ?? null,
            slot: null,
          };
        });
      forecasts.push({ participants, turns, isFixed: false, existingQueue: this.normalizedQueue(phase) });
      calendarIndices.push(i);
      occurrenceIndices.push(occurrences);
      state.definitions[i] = { ...definition };
    }
    const independentCount = forecasts.length;
    const groupedRooms: number[] = [];
    state.rooms.forEach((r, i) => {
      if (roomIDs.has(r.id)) groupedRooms.push(i);
    });
    groupedRooms.sort((a, b) => compareIDs(at(state.rooms, a).id, at(state.rooms, b).id));
    const groupedOccurrences: number[][] = [];
    for (const ri of groupedRooms) {
      const room = at(state.rooms, ri);
      const version = lastWhere(room.scheduleVersions, (v) => v.effectiveAt <= boundary);
      if (version === undefined) throw new DomainError("invalidSchedule");
      const ids = new Set(state.definitions.filter((d) => d.roomID === room.id && this.isRoomLinked(d, state)).map((d) => d.id));
      const occurrences: number[] = [];
      state.occurrences.forEach((o, j) => {
        if (ids.has(o.taskDefinitionID) && !isCompleted(o) && o.availableAt >= boundary) occurrences.push(j);
      });
      occurrences.sort((x, y) => {
        const a = at(state.occurrences, x);
        const b = at(state.occurrences, y);
        return a.availableAt === b.availableAt ? compareIDs(a.taskDefinitionID, b.taskDefinitionID) : a.availableAt - b.availableAt;
      });
      const turns: QueueTurn[] = occurrences
        .filter((j) => at(state.occurrences, j).availableAt < end)
        .map((j) => {
          const o = at(state.occurrences, j);
          const d = state.definitions.find((x) => x.id === o.taskDefinitionID);
          if (d === undefined) throw new DomainError("entityNotFound");
          return {
            week: this.weekIndex(o.availableAt, forecastStart),
            effort: o.effortSnapshot.points,
            eligible: new Set(this.members(d, o.availableAt, state)),
            incumbent: state.assignments.find((a) => a.occurrenceID === o.id && isActiveAssignment(a))?.userID ?? null,
            slot: this.roomSlot(room, version, d.id, o.availableAt),
          };
        });
      const period = this.periodIndex(room, boundary);
      if (room.calendarAnchor === null) throw new DomainError("invalidSchedule");
      const periodStart = this.addingWeeks(period * room.periodicity.intervalWeeks, room.calendarAnchor);
      const preserveCurrent = boundary === date &&
        state.occurrences.some((o) => ids.has(o.taskDefinitionID) && o.availableAt >= periodStart && o.availableAt < boundary);
      forecasts.push({ participants: version.queue, turns, isFixed: preserveCurrent, existingQueue: version.queue });
      groupedOccurrences.push(occurrences);
    }
    const fixedState = cloneSchedulingState(state);
    const replanned = new Set(
      indices.filter((i) => at(state.definitions, i).assignmentPolicy !== "afterCompletion").map((i) => at(state.definitions, i).id),
    );
    fixedState.occurrences = fixedState.occurrences.filter(
      (o) => !(replanned.has(o.taskDefinitionID) && o.availableAt >= boundary && !isCompleted(o)),
    );
    const fixed = this.projection(houseID, forecastStart, fixedState);
    const houseDebts = new Map<UserID, number>();
    for (const roomID of sortedIDs(roomIDs)) {
      for (const [user, value] of this.debts(roomID, state)) houseDebts.set(user, (houseDebts.get(user) ?? 0) + value);
    }
    const queues = new HouseQueueOptimizer().optimize(forecasts, fixed, houseDebts);
    calendarIndices.forEach((i, position) => {
      const queue = at(queues, position);
      state.definitions[i] = { ...at(state.definitions, i), rotationQueue: queue };
      at(occurrenceIndices, position).forEach((j, offset) => {
        const occurrence = at(state.occurrences, j);
        const nominal = queue.length === 0 ? null : at(queue, offset % queue.length);
        const eligible = this.members(at(state.definitions, i), occurrence.availableAt, state);
        const owner = nominal !== null && eligible.includes(nominal) ? nominal : null;
        this.replaceAssignment(j, owner, date, state);
      });
      state.definitions[i] = {
        ...at(state.definitions, i),
        currentRotationIndex: queue.length === 0 ? 0 : at(occurrenceIndices, position).length % queue.length,
      };
    });
    groupedRooms.forEach((ri, offset) => {
      const queue = at(queues, independentCount + offset);
      const room = at(state.rooms, ri);
      const vi = lastIndexWhere(room.scheduleVersions, (v) => v.effectiveAt <= boundary);
      if (vi < 0) throw new DomainError("invalidSchedule");
      const versions = [...room.scheduleVersions];
      versions[vi] = { ...at(versions, vi), queue };
      state.rooms[ri] = { ...room, scheduleVersions: versions };
      for (const j of at(groupedOccurrences, offset)) {
        const o = at(state.occurrences, j);
        const d = state.definitions.find((x) => x.id === o.taskDefinitionID);
        if (d === undefined) throw new DomainError("entityNotFound");
        this.replaceAssignment(j, this.roomOwner(d, o.availableAt, state), date, state);
      }
    });
  }

  // MARK: Fila, publicação e atribuição

  normalizedQueue(definition: TaskDefinition): UserID[] {
    if (definition.rotationQueue.length === 0) return [];
    const cursor = definition.currentRotationIndex;
    if (
      !Number.isInteger(cursor) || cursor < 0 || cursor >= definition.rotationQueue.length ||
      new Set(definition.rotationQueue).size !== definition.rotationQueue.length
    ) {
      throw new DomainError("invalidDistribution");
    }
    return [...definition.rotationQueue.slice(cursor), ...definition.rotationQueue.slice(0, cursor)];
  }

  activatePending(definition: DefinitionDraft, date: Instant): void {
    const pending = definition.pendingRotation;
    if (pending === null || pending.effectiveAt > date) return;
    definition.rotationQueue = pending.queue;
    definition.currentRotationIndex = 0;
    definition.pendingRotation = null;
  }

  replaceAssignment(occurrenceIndex: number, userID: UserID | null, date: Instant, state: SchedulingState): void {
    const occurrence = at(state.occurrences, occurrenceIndex);
    const active: number[] = [];
    state.assignments.forEach((a, i) => {
      if (a.occurrenceID === occurrence.id && isActiveAssignment(a)) active.push(i);
    });
    if (active.length === 1 && at(state.assignments, at(active, 0)).userID === userID) return;
    for (const i of active) state.assignments[i] = { ...at(state.assignments, i), supersededAt: date };
    if (userID !== null) {
      state.assignments.push({
        id: taskAssignmentID(this.newID()), occurrenceID: occurrence.id, userID,
        assignedAt: Math.max(date, occurrence.availableAt), endedAt: null, supersededAt: null,
      });
    }
    state.occurrences[occurrenceIndex] = { ...occurrence, status: userID === null ? "available" : "assigned" };
  }

  extend(definition: DefinitionDraft, end: Instant, state: SchedulingState): void {
    const first = definition.nextScheduledAt;
    if (first === null) return;
    for (const date of this.scheduledDates(first, definition, end)) {
      const next = this.nextDate(date, definition);
      this.publish(definition, date, next, state);
      definition.nextScheduledAt = next;
    }
  }

  publish(definition: DefinitionDraft, date: Instant, dueAt: Instant | null, state: SchedulingState): void {
    if (this.isRoomLinked(definition, state)) {
      this.appendOccurrence(definition, date, dueAt, this.roomOwner(definition, date, state), state);
      return;
    }
    this.activatePending(definition, date);
    if (definition.rotationQueue.length === 0) {
      this.appendOccurrence(definition, date, dueAt, null, state);
      return;
    }
    const user = definition.rotationQueue[definition.currentRotationIndex];
    if (user === undefined) throw new DomainError("invalidDistribution");
    const eligible = this.members(definition, date, state);
    // Férias não alteram silenciosamente uma fila estática publicada: o turno fica sem responsável.
    this.appendOccurrence(definition, date, dueAt, eligible.includes(user) ? user : null, state);
    definition.currentRotationIndex = this.rotation.advance(definition.currentRotationIndex, definition.rotationQueue);
  }

  appendOccurrence(
    definition: TaskDefinition, date: Instant, dueAt: Instant | null, userID: UserID | null, state: SchedulingState,
  ): void {
    const occurrence: TaskOccurrence = {
      id: taskOccurrenceID(this.newID()), taskDefinitionID: definition.id, availableAt: date, dueAt,
      status: userID === null ? "available" : "assigned", completedAt: null, completedByUserID: null,
      completionDebtImpacts: null, didPublishSuccessor: null, effortSnapshot: definition.effort,
    };
    state.occurrences.push(occurrence);
    if (userID !== null) {
      state.assignments.push({
        id: taskAssignmentID(this.newID()), occurrenceID: occurrence.id, userID, assignedAt: date,
        endedAt: null, supersededAt: null,
      });
    }
  }

  // MARK: Consultas de estado

  /** Participantes elegíveis, ordenados por UUID. `at: null` usa a participação atual. */
  members(
    definition: TaskDefinition, date: Instant | null, state: SchedulingState,
    options: { includeAbsent?: boolean; useCurrentMembership?: boolean } = {},
  ): UserID[] {
    const includeAbsent = options.includeAbsent ?? false;
    const useCurrentMembership = options.useCurrentMembership ?? false;
    const houseID = this.room(definition, state).houseID;
    const houseMembers = state.houseMemberships.filter((m) => m.houseID === houseID);
    const houseUsers = new Set(houseMembers.map((m) => m.userID));
    let absent = new Set<UserID>();
    if (date !== null && !includeAbsent) {
      const absentIDs = new Set(state.absences.filter((a) => a.startsAt <= date && date < a.endsAt).map((a) => a.membershipID));
      absent = new Set(houseMembers.filter((m) => absentIDs.has(m.id)).map((m) => m.userID));
    }
    const result = new Set<UserID>();
    for (const m of state.roomMemberships) {
      if (m.roomID !== definition.roomID || !houseUsers.has(m.userID) || absent.has(m.userID)) continue;
      const counts = useCurrentMembership || date === null ? isCurrentMember(m) : participatesAt(m, date);
      if (counts) result.add(m.userID);
    }
    return sortedIDs(result);
  }

  debts(roomID: RoomID, state: SchedulingState): Map<UserID, number> {
    const result = new Map<UserID, number>();
    for (const m of state.roomMemberships) {
      if (m.roomID !== roomID) continue;
      if (result.has(m.userID) || !Number.isFinite(m.fairnessDebt)) throw new DomainError("invalidDistribution");
      result.set(m.userID, m.fairnessDebt);
    }
    return result;
  }

  room(definition: TaskDefinition, state: SchedulingState): Room {
    const room = state.rooms.find((r) => r.id === definition.roomID);
    if (room === undefined) throw new DomainError("entityNotFound");
    return room;
  }

  projection(houseID: HouseID, start: Instant, state: SchedulingState): Map<UserID, ProjectedWeek[]> {
    const roomIDs = new Set(state.rooms.filter((r) => r.houseID === houseID).map((r) => r.id));
    const definitionIDs = new Set(state.definitions.filter((d) => roomIDs.has(d.roomID)).map((d) => d.id));
    const end = this.addingWeeks(HORIZON_WEEKS, start);
    const owners = new Map<TaskOccurrenceID, UserID>();
    for (const assignment of state.assignments) {
      if (!isActiveAssignment(assignment)) continue;
      if (owners.has(assignment.occurrenceID)) throw new DomainError("invalidDistribution");
      owners.set(assignment.occurrenceID, assignment.userID);
    }
    const result = new Map<UserID, ProjectedWeek[]>();
    for (const occurrence of state.occurrences) {
      if (!definitionIDs.has(occurrence.taskDefinitionID) || isCompleted(occurrence) ||
        !(occurrence.availableAt >= start && occurrence.availableAt < end)) continue;
      // O esforço concluído já está no saldo: não conta duas vezes.
      const user = owners.get(occurrence.id);
      if (user === undefined) continue;
      const points = occurrence.effortSnapshot.points;
      if (!Number.isInteger(points) || points < 1 || points > 3) throw new DomainError("invalidDistribution");
      const weeks = [...(result.get(user) ?? emptyWeeks())];
      const week = this.weekIndex(occurrence.availableAt, start);
      weeks[week] = addEffort(at(weeks, week), points);
      result.set(user, weeks);
    }
    return result;
  }

  suggestedResident(roomID: RoomID, date: Instant, state: SchedulingState): UserID | null {
    const room = state.rooms.find((r) => r.id === roomID);
    if (room === undefined) throw new DomainError("entityNotFound");
    const houseMembers = new Set(state.houseMemberships.filter((m) => m.houseID === room.houseID).map((m) => m.userID));
    const candidates = new Set<UserID>();
    for (const m of state.roomMemberships) {
      if (m.roomID === roomID && isCurrentMember(m) && houseMembers.has(m.userID)) candidates.add(m.userID);
    }
    if (candidates.size === 0) return null;
    const loads = this.projection(room.houseID, this.weekStart(date), state);
    const load = (user: UserID): number => loads.get(user)?.[0]?.load ?? 0;
    const sorted = [...candidates].sort((a, b) => (load(a) !== load(b) ? load(a) - load(b) : compareIDs(a, b)));
    return sorted[0] ?? null;
  }

  // MARK: Datas

  nextDate(date: Instant, definition: TaskDefinition): Instant {
    if (definition.calendarAnchor !== null && weeklyPeriodicityOf(definition.recurrence) !== null) {
      return this.firstWeeklyDate(this.adding("day", 1, this.calendar.startOfDay(date)), definition);
    }
    const policy = definition.recurrence;
    if (policy.kind !== "recurring" || policy.interval <= 0) throw new DomainError("invalidSchedule");
    switch (policy.frequency) {
      case "daily": return this.adding("day", policy.interval, date);
      // O semanal é ancorado no calendário de segunda-feira.
      case "weekly": return this.addingWeeks(policy.interval, this.weekStart(date));
      case "monthly": return this.adding("month", policy.interval, date);
      case "yearly": return this.adding("year", policy.interval, date);
    }
  }

  scheduledDates(first: Instant, definition: TaskDefinition, end: Instant): Instant[] {
    const dates: Instant[] = [];
    let date = first;
    while (date < end) {
      dates.push(date);
      const next = this.nextDate(date, definition);
      if (!(next > date)) throw new DomainError("invalidSchedule");
      date = next;
    }
    return dates;
  }

  weekStart(date: Instant): Instant {
    return this.calendar.weekStart(date);
  }

  addingWeeks(count: number, date: Instant): Instant {
    return this.calendar.addWeeks(date, count);
  }

  adding(component: "day" | "month" | "year", count: number, date: Instant): Instant {
    switch (component) {
      case "day": return this.calendar.addDays(date, count);
      case "month": return this.calendar.addMonths(date, count);
      case "year": return this.calendar.addYears(date, count);
    }
  }

  /** Semana (0...11) de `date` relativa a `start`; fora do horizonte é erro. */
  weekIndex(date: Instant, start: Instant): number {
    const week = this.calendar.weeksBetween(start, this.weekStart(date));
    if (week < 0 || week >= HORIZON_WEEKS) throw new DomainError("invalidDateInterval");
    return week;
  }

  // MARK: Escala compartilhada do cômodo

  isRoomLinked(definition: TaskDefinition, state: SchedulingState): boolean {
    if (definition.kind !== "recurring" || definition.assignmentPolicy === "afterCompletion" ||
      definition.assignmentPolicy === "selfAssigned") return false;
    const period = weeklyPeriodicityOf(definition.recurrence);
    return state.rooms.some((r) => r.id === definition.roomID && period !== null && samePeriodicity(period, r.periodicity));
  }

  initializeRooms(houseID: HouseID, date: Instant, state: SchedulingState): void {
    for (let i = 0; i < state.rooms.length; i++) {
      const room = at(state.rooms, i);
      if (room.houseID !== houseID) continue;
      if (!isValidPeriodicity(room.periodicity) || room.responsibleCount <= 0) throw new DomainError("invalidSchedule");
      const anchor = room.calendarAnchor ?? this.weekStart(date);
      if (room.calendarAnchor === null) state.rooms[i] = { ...room, calendarAnchor: anchor };
      if (room.scheduleVersions.length === 0) this.configureRoom(room.id, anchor, state);
    }
  }

  periodIndex(room: Room, date: Instant): number {
    if (room.calendarAnchor === null) throw new DomainError("invalidSchedule");
    const days = this.calendar.daysBetween(room.calendarAnchor, this.calendar.startOfDay(date));
    return Math.max(0, Math.trunc(days / (7 * room.periodicity.intervalWeeks)));
  }

  configureRoom(roomID: RoomID, boundary: Instant, state: SchedulingState): void {
    const ri = state.rooms.findIndex((r) => r.id === roomID);
    const room = state.rooms[ri];
    if (room === undefined) throw new DomainError("entityNotFound");
    const houseUsers = new Set(state.houseMemberships.filter((m) => m.houseID === room.houseID).map((m) => m.userID));
    const users = sortedIDs(
      new Set(
        state.roomMemberships
          .filter((m) => m.roomID === roomID && participatesAt(m, boundary) && houseUsers.has(m.userID))
          .map((m) => m.userID),
      ),
    );
    const previous = lastWhere(room.scheduleVersions, (v) => v.effectiveAt <= boundary);
    const retained = (previous?.queue ?? []).filter((u) => users.includes(u));
    const queue = [...retained, ...users.filter((u) => !retained.includes(u))];
    const count = Math.min(room.responsibleCount, queue.length);
    const loads: number[] = new Array<number>(count).fill(0);
    const amounts: number[] = new Array<number>(count).fill(0);
    const roles: Record<string, number> = {};
    const tasks = state.definitions
      .filter((d) => d.roomID === roomID && this.isRoomLinked(d, state))
      .sort((a, b) => (a.effort.points === b.effort.points ? compareIDs(a.id, b.id) : b.effort.points - a.effort.points));
    if (count > 0) {
      for (const task of tasks) {
        let role = 0;
        for (let candidate = 1; candidate < count; candidate++) {
          const lessLoad = at(loads, candidate) !== at(loads, role)
            ? at(loads, candidate) < at(loads, role)
            : at(amounts, candidate) !== at(amounts, role)
            ? at(amounts, candidate) < at(amounts, role)
            : candidate < role;
          if (lessLoad) role = candidate;
        }
        roles[task.id] = role;
        loads[role] = at(loads, role) + task.effort.points;
        amounts[role] = at(amounts, role) + 1;
      }
    }
    // Preserva a fase quando a composição não muda, inclusive criação de tarefa no meio do período.
    const index = this.periodIndex(room, boundary);
    let phasedQueue = queue;
    if (previous !== undefined && queue.length > 0 &&
      previous.queue.length === queue.length && previous.queue.every((u, i) => u === queue[i])) {
      const shift = ((index - previous.periodIndex) * previous.responsibleCount) % queue.length;
      if (shift < 0) throw new DomainError("invalidSchedule");
      phasedQueue = [...queue.slice(shift), ...queue.slice(0, shift)];
    }
    const version: RoomScheduleVersion = {
      effectiveAt: boundary, queue: phasedQueue, responsibleCount: count, taskRoles: roles, periodIndex: index,
    };
    state.rooms[ri] = {
      ...room,
      scheduleVersions: [...room.scheduleVersions.filter((v) => v.effectiveAt < boundary), version],
    };
  }

  roomSlot(room: Room, version: RoomScheduleVersion, taskID: TaskDefinitionID, date: Instant): number {
    const period = this.periodIndex(room, date);
    return Math.max(0, period - version.periodIndex) * version.responsibleCount + (lookup(version.taskRoles, taskID) ?? 0);
  }

  roomOwner(definition: TaskDefinition, date: Instant, state: SchedulingState): UserID | null {
    const room = this.room(definition, state);
    const version = lastWhere(room.scheduleVersions, (v) => v.effectiveAt <= date);
    if (version === undefined || version.queue.length === 0 || lookup(version.taskRoles, definition.id) === undefined) {
      return null;
    }
    const slot = this.roomSlot(room, version, definition.id, date);
    const owner = at(version.queue, slot % version.queue.length);
    return this.members(definition, date, state).includes(owner) ? owner : null;
  }

  firstWeeklyDate(date: Instant, definition: TaskDefinition): Instant {
    const period = weeklyPeriodicityOf(definition.recurrence);
    if (period === null || !isValidPeriodicity(period)) throw new DomainError("invalidSchedule");
    const anchor = definition.calendarAnchor ?? this.weekStart(date);
    const days = this.calendar.daysBetween(anchor, this.calendar.startOfDay(date));
    const length = period.intervalWeeks * 7;
    let cycle = Math.max(0, Math.trunc(days / length));
    for (;;) {
      for (let i = 0; i < period.executionsPerPeriod; i++) {
        // Piso exato de i * length / n, sem estourar o produto intermediário.
        const offset = Number((BigInt(i) * BigInt(length)) / BigInt(period.executionsPerPeriod));
        const candidate = this.adding("day", cycle * length + offset, anchor);
        if (candidate >= date) return candidate;
      }
      cycle += 1;
    }
  }

  deleteRoom(roomID: RoomID, state: SchedulingState): void {
    const definitions = new Set(state.definitions.filter((d) => d.roomID === roomID).map((d) => d.id));
    const occurrences = new Set(state.occurrences.filter((o) => definitions.has(o.taskDefinitionID)).map((o) => o.id));
    state.assignments = state.assignments.filter((a) => !occurrences.has(a.occurrenceID));
    state.occurrences = state.occurrences.filter((o) => !definitions.has(o.taskDefinitionID));
    state.definitions = state.definitions.filter((d) => !definitions.has(d.id));
    state.roomMemberships = state.roomMemberships.filter((m) => m.roomID !== roomID);
    state.rooms = state.rooms.filter((r) => r.id !== roomID);
  }
}

export type { RoomMembership, TaskAssignment };
