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
  /** Chave da foto de perfil no armazenamento de objetos; ausente = sem foto (o avatar mostra as iniciais). */
  readonly photoKey?: string;
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
  /** Previsão: quem assume no próximo ciclo, pela fila atual (muda se alguém entrar ou sair). Vazio sem fila. */
  readonly nextResponsibleNames: readonly string[];
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
  /** Quem concluiu uma tarefa única pula a vez na próxima tarefa de repetição própria do cômodo (uma vez só). */
  readonly skipsNextOwnTurn: boolean;
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
  /** Quando a tarefa foi encerrada (`endTask`): a definição e o histórico ficam, nada novo é publicado. */
  readonly endedAt: Instant | null;
  /** Quem criou a tarefa. Só a avulsa o usa (editar e excluir são de quem criou); ausente em tarefas anteriores ao atributo. */
  readonly createdByUserID?: UserID;
  /**
   * "Repetir com o cômodo": a tarefa segue a escala e a periodicidade do cômodo. Ausente = definição antiga: vale a
   * periodicidade igual à do cômodo. Quando o cômodo muda de periodicidade, as tarefas que o acompanham mudam junto.
   */
  readonly followsRoom?: boolean;
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

/** `cancelled`: quem pediu desistiu enquanto estava pendente. */
export type TaskSwapRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

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

export type AppNotificationKind =
  | "taskSwapRequested" | "taskSwapAccepted" | "taskSwapRejected"
  | "taskEdited" | "taskDeleted" | "effortChanged"
  | "memberJoined" | "memberLeft"
  | "roomDeleted" | "roomAccessRequested" | "roomAccessApproved" | "roomAccessDenied"
  | "cycleTurned" | "weeklySummaryReady";

/**
 * Aviso para um morador. O texto é montado pelo app a partir destes dados (idioma do aparelho), nunca gravado aqui:
 * `subjectName` guarda o nome (da tarefa, do cômodo ou do morador) como era na hora, porque o objeto pode ter sido
 * apagado ou ter saído da casa.
 */
export interface AppNotification {
  readonly id: NotificationID;
  readonly recipientUserID: UserID;
  /** Casa a que o aviso pertence (a partição, no DynamoDB). */
  readonly houseID: HouseID;
  readonly kind: AppNotificationKind;
  readonly swapRequestID: TaskSwapRequestID | null;
  readonly taskDefinitionID: TaskDefinitionID | null;
  readonly roomID: RoomID | null;
  /** Quem fez a ação (nunca o destinatário). */
  readonly actorUserID: UserID | null;
  readonly subjectName: string | null;
  /**
   * Detalhes da segunda linha do aviso (todos opcionais; o texto é montado no app, no idioma do aparelho):
   * `roomName` (cômodo da tarefa editada ou apagada), `taskName` e `dueAt` (troca aceita: a tarefa que quem pediu passa a
   * fazer e até quando; virada de ciclo: até quando vale), `effortFrom`/`effortTo` (1 a 3, esforço que mudou) e `names`
   * (virada de ciclo: os outros responsáveis).
   */
  readonly roomName: string | null;
  readonly taskName: string | null;
  readonly dueAt: Instant | null;
  readonly effortFrom: number | null;
  readonly effortTo: number | null;
  readonly names: readonly string[];
  readonly createdAt: Instant;
  readonly readAt: Instant | null;
}

/**
 * Pedido de um morador para entrar num cômodo privado. A chave natural é (cômodo, morador): só existe um pedido
 * aberto por par; aprovar, recusar ou cancelar o apaga.
 */
export interface RoomAccessRequest {
  readonly roomID: RoomID;
  readonly userID: UserID;
  readonly requestedAt: Instant;
}

/** Como o cômodo foi cuidado no ciclo: três níveis, sem estrelas nem texto livre (docs/DESIGN.md). */
export const RATING_LEVELS = ["needsWork", "good", "great"] as const;
export type RoomRatingLevel = (typeof RATING_LEVELS)[number];

/**
 * Tags opcionais e genéricas da avaliação (catálogo fixo; sem texto livre; docs/DESIGN.md). As quatro primeiras dizem o
 * que foi bom (níveis `good` e `great`), as outras quatro o que pode melhorar (nível `needsWork`).
 */
export const RATING_TAGS = [
  "spotless", "tidy", "onTime", "careful", "notCleaned", "messy", "halfDone", "tookTooLong",
] as const;
export type RoomRatingTag = (typeof RATING_TAGS)[number];

const IMPROVEMENT_TAGS: readonly RoomRatingTag[] = ["notCleaned", "messy", "halfDone", "tookTooLong"];

/** `true` para as tags de "o que pode melhorar"; as demais são de "o que foi bom". */
export function isImprovementTag(tag: RoomRatingTag): boolean {
  return IMPROVEMENT_TAGS.includes(tag);
}

/** Cada nível só aceita as tags do seu lado: `needsWork` as de melhorar, `good` e `great` as de elogio. */
export function tagMatchesLevel(tag: RoomRatingTag, level: RoomRatingLevel): boolean {
  return isImprovementTag(tag) === (level === "needsWork");
}

/**
 * Avaliação anônima de um cômodo num ciclo. A chave natural é (cômodo, início do ciclo, quem avaliou): refazer dentro
 * da janela substitui. Quem avaliou nunca sai do servidor; só o resultado agregado é mostrado a quem cuidou do cômodo.
 */
export interface RoomRating {
  readonly roomID: RoomID;
  /** Início do ciclo avaliado (o `periodStart` do cômodo). */
  readonly periodStart: Instant;
  readonly raterID: UserID;
  readonly level: RoomRatingLevel;
  readonly tags: readonly RoomRatingTag[];
  readonly ratedAt: Instant;
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
