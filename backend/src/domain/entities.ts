import { compareText } from "./arrays.ts";
import { DISTANT_FUTURE, type Instant } from "./dates.ts";
import { DomainError } from "./errors.ts";
import type {
  AbsenceID, HouseID, HouseMembershipID, NotificationID, RoomID, RoomMembershipID, TaskAssignmentID,
  TaskDefinitionID, TaskOccurrenceID, TaskSwapRequestID, UserID,
} from "./ids.ts";
import type {
  RecurrencePolicy, RoomCategory, RoomColor, RoomKind, RoomVisibility, TaskAssignmentPolicy, TaskEffort,
  TaskKind, TaskOccurrenceStatus, WeeklyPeriodicity,
} from "./value-objects.ts";

export interface User {
  readonly id: UserID;
  readonly name: string;
  readonly email: string | null;
}

export interface House {
  readonly id: HouseID;
  readonly name: string;
  readonly accessCode: string;
  readonly createdAt: Instant;
  /** Fuso IANA da casa: a virada de semana (segunda 00:00) acontece nele. */
  readonly timezone: string;
}

export interface HouseMembership {
  readonly id: HouseMembershipID;
  readonly houseID: HouseID;
  readonly userID: UserID;
}

export interface RoomScheduleVersion {
  readonly effectiveAt: Instant;
  readonly queue: readonly UserID[];
  readonly responsibleCount: number;
  /** Tarefa → posição responsável (chave: `TaskDefinitionID`). */
  readonly taskRoles: Readonly<Record<string, number>>;
  readonly periodIndex: number;
}

export interface Room {
  readonly id: RoomID;
  readonly houseID: HouseID;
  readonly name: string;
  readonly kind: RoomKind;
  readonly category: RoomCategory;
  readonly visibility: RoomVisibility;
  readonly periodicity: WeeklyPeriodicity;
  readonly responsibleCount: number;
  readonly calendarAnchor: Instant | null;
  readonly scheduleVersions: readonly RoomScheduleVersion[];
  readonly icon: string;
  readonly color: RoomColor;
}

export function representsWholeHouse(room: Room): boolean {
  return room.kind === "wholeHouse";
}

export interface RoomParticipation {
  readonly room: Room;
  readonly isMember: boolean;
  readonly memberCount: number;
  readonly responsibleNames: readonly string[];
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
}

export interface RotationParticipationChange {
  readonly effectiveAt: Instant;
  readonly participates: boolean;
}

export interface RoomMembership {
  readonly id: RoomMembershipID;
  readonly roomID: RoomID;
  readonly userID: UserID;
  /** Saldo de justiça do cômodo: positivo = executou mais que a cota. Não é moeda nem placar. */
  readonly fairnessDebt: number;
  /** Fim do acesso geral ao cômodo. A rotação muda na segunda seguinte (`rotationChanges`). */
  readonly leftAt: Instant | null;
  /** `null` = registro legado: participa desde sempre. */
  readonly rotationChanges: readonly RotationParticipationChange[] | null;
}

export function isCurrentMember(membership: RoomMembership): boolean {
  return membership.leftAt === null;
}

/** Última mudança de rotação com vigência até `date`; sem mudanças, participa. */
export function participatesAt(membership: RoomMembership, date: Instant): boolean {
  let latest: RotationParticipationChange | undefined;
  for (const change of membership.rotationChanges ?? []) {
    if (change.effectiveAt <= date && (latest === undefined || change.effectiveAt > latest.effectiveAt)) {
      latest = change;
    }
  }
  return latest?.participates ?? true;
}

export interface PendingRotation {
  readonly effectiveAt: Instant;
  readonly queue: readonly UserID[];
}

export interface TaskDefinition {
  readonly id: TaskDefinitionID;
  readonly roomID: RoomID;
  readonly name: string;
  readonly details: string;
  readonly effort: TaskEffort;
  readonly kind: TaskKind;
  readonly recurrence: RecurrencePolicy;
  readonly assignmentPolicy: TaskAssignmentPolicy;
  readonly sourceSuggestionID: string | null;
  readonly rotationQueue: readonly UserID[];
  readonly currentRotationIndex: number;
  readonly nextScheduledAt: Instant | null;
  readonly pendingRotation: PendingRotation | null;
  readonly calendarAnchor: Instant | null;
}

export interface TaskOccurrence {
  readonly id: TaskOccurrenceID;
  readonly taskDefinitionID: TaskDefinitionID;
  readonly availableAt: Instant;
  readonly dueAt: Instant | null;
  readonly status: TaskOccurrenceStatus;
  readonly completedAt: Instant | null;
  readonly completedByUserID: UserID | null;
  /** Impacto no saldo de cada membro no momento da conclusão (chave: `UserID`). */
  readonly completionDebtImpacts: Readonly<Record<string, number>> | null;
  readonly didPublishSuccessor: boolean | null;
  /** Esforço no momento da publicação: alterar a definição não muda ocorrências existentes. */
  readonly effortSnapshot: TaskEffort;
}

export function isCompleted(occurrence: TaskOccurrence): boolean {
  return occurrence.status === "completed";
}

export interface TaskAssignment {
  readonly id: TaskAssignmentID;
  readonly occurrenceID: TaskOccurrenceID;
  readonly userID: UserID;
  readonly assignedAt: Instant;
  readonly endedAt: Instant | null;
  /** Cancela um plano futuro substituído sem inventar um intervalo negativo. */
  readonly supersededAt: Instant | null;
}

export function isActiveAssignment(assignment: TaskAssignment): boolean {
  return assignment.endedAt === null && assignment.supersededAt === null;
}

export interface TaskItem {
  readonly definition: TaskDefinition;
  readonly occurrence: TaskOccurrence;
  readonly assignment: TaskAssignment | null;
  readonly assignee: User | null;
  readonly suggestedAssignee: User | null;
}

export function taskItem(
  definition: TaskDefinition,
  occurrence: TaskOccurrence,
  assignment: TaskAssignment | null,
  assignee: User | null = null,
  suggestedAssignee: User | null = null,
): TaskItem {
  return { definition, occurrence, assignment, assignee, suggestedAssignee };
}

/** Sem prazo vai depois; empates são estáveis entre recarregamentos (nome, depois ID da ocorrência). */
export function sortedByDeadline(items: readonly TaskItem[]): TaskItem[] {
  return [...items].sort((a, b) => {
    const left = a.occurrence.dueAt ?? DISTANT_FUTURE;
    const right = b.occurrence.dueAt ?? DISTANT_FUTURE;
    if (left !== right) return left < right ? -1 : 1;
    const byName = compareText(a.definition.name, b.definition.name);
    if (byName !== 0) return byName;
    return compareText(a.occurrence.id, b.occurrence.id);
  });
}

export type TaskSwapRequestStatus = "pending" | "accepted" | "rejected";

export interface TaskSwapRequest {
  readonly id: TaskSwapRequestID;
  readonly requesterID: UserID;
  readonly receiverID: UserID;
  readonly offeredOccurrenceID: TaskOccurrenceID;
  readonly requestedOccurrenceID: TaskOccurrenceID;
  readonly status: TaskSwapRequestStatus;
  readonly createdAt: Instant;
  readonly resolvedAt: Instant | null;
}

export type AppNotificationKind = "taskSwapRequested" | "taskSwapAccepted" | "taskSwapRejected";

export interface AppNotification {
  readonly id: NotificationID;
  readonly recipientUserID: UserID;
  readonly kind: AppNotificationKind;
  readonly swapRequestID: TaskSwapRequestID;
  readonly createdAt: Instant;
  readonly readAt: Instant | null;
}

export interface Absence {
  readonly id: AbsenceID;
  readonly membershipID: HouseMembershipID;
  readonly startsAt: Instant;
  readonly endsAt: Instant;
  readonly reason: string | null;
}

export function createAbsence(input: Omit<Absence, "reason"> & { readonly reason?: string | null }): Absence {
  if (input.startsAt > input.endsAt) throw new DomainError("invalidDateInterval");
  return { ...input, reason: input.reason ?? null };
}

export interface TaskSuggestion {
  readonly id: string;
  readonly name: string;
  readonly details: string;
  readonly effort: TaskEffort;
}

/** Estado sobre o qual as transições de agendamento operam, independente da tecnologia de armazenamento. */
export interface SchedulingState {
  rooms: Room[];
  houseMemberships: HouseMembership[];
  roomMemberships: RoomMembership[];
  definitions: TaskDefinition[];
  occurrences: TaskOccurrence[];
  assignments: TaskAssignment[];
  absences: Absence[];
}

/** Cópia por valor: as entidades são imutáveis, então copiar os arrays basta. */
export function cloneSchedulingState(state: SchedulingState): SchedulingState {
  return {
    rooms: [...state.rooms],
    houseMemberships: [...state.houseMemberships],
    roomMemberships: [...state.roomMemberships],
    definitions: [...state.definitions],
    occurrences: [...state.occurrences],
    assignments: [...state.assignments],
    absences: [...state.absences],
  };
}
