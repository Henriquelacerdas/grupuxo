import type { HouseSnapshot } from "../domain/commands/house-snapshot.ts";
import { formatInstant, type Instant } from "../domain/dates.ts";
import type {
  AppNotification, AppNotificationKind, House, Room, RoomParticipation, TaskAssignment, TaskDefinition, TaskItem,
  TaskOccurrence, TaskSwapRequest, TaskSwapRequestStatus, User,
} from "../domain/entities.ts";
import type { RecurrencePolicy, RoomCategory, RoomColor, RoomKind, RoomVisibility, TaskAssignmentPolicy, TaskKind, TaskOccurrenceStatus, WeeklyPeriodicity } from "../domain/value-objects.ts";
import { assertNever } from "../domain/value-objects.ts";

// Formato JSON das respostas da `api` (BACKEND.md, seção 6.1). Funções puras, sem `node:*`: o app decodifica os mesmos
// arquivos de `test/fixtures/api/`. Instantes são texto ISO 8601 em UTC com milissegundos (`2026-10-12T09:00:00.000Z`).
// Campos internos do agendamento (fila de rotação, versões da escala, impacto no saldo) não saem do servidor.

export type IsoInstant = string;

export interface UserDTO {
  readonly id: string;
  readonly name: string;
  /** URL de leitura da foto (estável por dia); `null` = sem foto, o avatar mostra as iniciais. */
  readonly photoURL: string | null;
}

/** Resolve a URL da foto de um morador (assinada por quem monta a resposta); sem armazenamento, nunca há foto. */
export type PhotoURL = (user: User) => string | null;
export const noPhotos: PhotoURL = () => null;

export interface HouseDTO {
  readonly id: string;
  readonly name: string;
  readonly accessCode: string;
  readonly timezone: string;
  readonly createdAt: IsoInstant;
}

export interface PeriodicityDTO {
  readonly executionsPerPeriod: number;
  readonly intervalWeeks: number;
}

export interface RoomDTO {
  readonly id: string;
  readonly houseID: string;
  readonly name: string;
  readonly kind: RoomKind;
  readonly category: RoomCategory;
  readonly visibility: RoomVisibility;
  readonly periodicity: PeriodicityDTO;
  readonly responsibleCount: number;
  readonly calendarAnchor: IsoInstant | null;
  readonly icon: string;
  readonly color: RoomColor;
}

export interface RoomParticipationDTO {
  readonly room: RoomDTO;
  readonly isMember: boolean;
  readonly memberCount: number;
  readonly responsibleNames: readonly string[];
  readonly nextResponsibleNames: readonly string[];
  readonly periodStart: IsoInstant;
  readonly periodEnd: IsoInstant;
}

export type RecurrenceDTO =
  | { readonly kind: "none" }
  | { readonly kind: "recurring"; readonly frequency: "daily" | "weekly" | "monthly" | "yearly"; readonly interval: number }
  | { readonly kind: "weekly"; readonly periodicity: PeriodicityDTO };

export interface TaskDefinitionDTO {
  readonly id: string;
  readonly roomID: string;
  readonly name: string;
  readonly details: string;
  /** 1 a 3. Carga interna: o app não exibe como pontuação. */
  readonly effort: number;
  readonly kind: TaskKind;
  readonly recurrence: RecurrenceDTO;
  readonly assignmentPolicy: TaskAssignmentPolicy;
  readonly calendarAnchor: IsoInstant | null;
  /** `null` = tarefa ativa. */
  readonly endedAt: IsoInstant | null;
  /** Quem criou a tarefa; `null` em tarefas anteriores ao atributo. Só a avulsa criada por quem pede tem Editar e Excluir. */
  readonly createdByUserID: string | null;
  /** "Repetir com o cômodo"; `null` = definição antiga (vale a periodicidade igual à do cômodo). */
  readonly followsRoom: boolean | null;
}

export interface TaskOccurrenceDTO {
  readonly id: string;
  readonly taskDefinitionID: string;
  readonly availableAt: IsoInstant;
  readonly dueAt: IsoInstant | null;
  readonly status: TaskOccurrenceStatus;
  readonly completedAt: IsoInstant | null;
  readonly completedByUserID: string | null;
  readonly effort: number;
}

export interface TaskAssignmentDTO {
  readonly id: string;
  readonly userID: string;
  readonly assignedAt: IsoInstant;
  readonly endedAt: IsoInstant | null;
}

export interface TaskItemDTO {
  readonly definition: TaskDefinitionDTO;
  readonly occurrence: TaskOccurrenceDTO;
  readonly assignment: TaskAssignmentDTO | null;
  readonly assignee: UserDTO | null;
  readonly suggestedAssignee: UserDTO | null;
}

export interface TaskSwapRequestDTO {
  readonly id: string;
  readonly requesterID: string;
  readonly receiverID: string;
  readonly offeredOccurrenceID: string;
  readonly requestedOccurrenceID: string;
  readonly status: TaskSwapRequestStatus;
  readonly createdAt: IsoInstant;
  readonly resolvedAt: IsoInstant | null;
}

export interface NotificationDTO {
  readonly id: string;
  readonly kind: AppNotificationKind;
  readonly swapRequestID: string | null;
  readonly taskDefinitionID: string | null;
  readonly roomID: string | null;
  readonly actorUserID: string | null;
  /** Nome da tarefa, do cômodo ou do morador como era na hora do aviso. */
  readonly subjectName: string | null;
  readonly createdAt: IsoInstant;
  /** `null` = não lida. */
  readonly readAt: IsoInstant | null;
}

export interface MyHouseDTO {
  readonly house: HouseDTO;
  readonly members: readonly UserDTO[];
  readonly rooms: readonly RoomDTO[];
}

const iso = (instant: Instant): IsoInstant => formatInstant(instant);
const isoOrNull = (instant: Instant | null): IsoInstant | null => (instant === null ? null : iso(instant));

export function userDTO(user: User, photoURL: PhotoURL = noPhotos): UserDTO {
  return { id: user.id, name: user.name, photoURL: photoURL(user) };
}

export function houseDTO(house: House): HouseDTO {
  return { id: house.id, name: house.name, accessCode: house.accessCode, timezone: house.timezone, createdAt: iso(house.createdAt) };
}

function periodicityDTO(value: WeeklyPeriodicity): PeriodicityDTO {
  return { executionsPerPeriod: value.executionsPerPeriod, intervalWeeks: value.intervalWeeks };
}

export function roomDTO(room: Room): RoomDTO {
  return {
    id: room.id, houseID: room.houseID, name: room.name, kind: room.kind, category: room.category,
    visibility: room.visibility, periodicity: periodicityDTO(room.periodicity), responsibleCount: room.responsibleCount,
    calendarAnchor: isoOrNull(room.calendarAnchor), icon: room.icon, color: room.color,
  };
}

export function roomParticipationDTO(participation: RoomParticipation): RoomParticipationDTO {
  return {
    room: roomDTO(participation.room), isMember: participation.isMember, memberCount: participation.memberCount,
    responsibleNames: [...participation.responsibleNames],
    nextResponsibleNames: [...participation.nextResponsibleNames], periodStart: iso(participation.periodStart),
    periodEnd: iso(participation.periodEnd),
  };
}

export function recurrenceDTO(policy: RecurrencePolicy): RecurrenceDTO {
  switch (policy.kind) {
    case "none": return { kind: "none" };
    case "recurring": return { kind: "recurring", frequency: policy.frequency, interval: policy.interval };
    case "weekly": return { kind: "weekly", periodicity: periodicityDTO(policy.periodicity) };
    default: return assertNever(policy);
  }
}

export function taskDefinitionDTO(definition: TaskDefinition): TaskDefinitionDTO {
  return {
    id: definition.id, roomID: definition.roomID, name: definition.name, details: definition.details,
    effort: definition.effort.points, kind: definition.kind, recurrence: recurrenceDTO(definition.recurrence),
    assignmentPolicy: definition.assignmentPolicy, calendarAnchor: isoOrNull(definition.calendarAnchor),
    endedAt: isoOrNull(definition.endedAt), createdByUserID: definition.createdByUserID ?? null,
    followsRoom: definition.followsRoom ?? null,
  };
}

function occurrenceDTO(occurrence: TaskOccurrence): TaskOccurrenceDTO {
  return {
    id: occurrence.id, taskDefinitionID: occurrence.taskDefinitionID, availableAt: iso(occurrence.availableAt),
    dueAt: isoOrNull(occurrence.dueAt), status: occurrence.status, completedAt: isoOrNull(occurrence.completedAt),
    completedByUserID: occurrence.completedByUserID, effort: occurrence.effortSnapshot.points,
  };
}

function assignmentDTO(assignment: TaskAssignment): TaskAssignmentDTO {
  return { id: assignment.id, userID: assignment.userID, assignedAt: iso(assignment.assignedAt), endedAt: isoOrNull(assignment.endedAt) };
}

export function taskItemDTO(item: TaskItem, photoURL: PhotoURL = noPhotos): TaskItemDTO {
  return {
    definition: taskDefinitionDTO(item.definition), occurrence: occurrenceDTO(item.occurrence),
    assignment: item.assignment === null ? null : assignmentDTO(item.assignment),
    assignee: item.assignee === null ? null : userDTO(item.assignee, photoURL),
    suggestedAssignee: item.suggestedAssignee === null ? null : userDTO(item.suggestedAssignee, photoURL),
  };
}

export function taskSwapRequestDTO(request: TaskSwapRequest): TaskSwapRequestDTO {
  return {
    id: request.id, requesterID: request.requesterID, receiverID: request.receiverID,
    offeredOccurrenceID: request.offeredOccurrenceID, requestedOccurrenceID: request.requestedOccurrenceID,
    status: request.status, createdAt: iso(request.createdAt), resolvedAt: isoOrNull(request.resolvedAt),
  };
}

export function notificationDTO(notification: AppNotification): NotificationDTO {
  return {
    id: notification.id, kind: notification.kind, swapRequestID: notification.swapRequestID,
    taskDefinitionID: notification.taskDefinitionID, roomID: notification.roomID,
    actorUserID: notification.actorUserID, subjectName: notification.subjectName,
    createdAt: iso(notification.createdAt), readAt: isoOrNull(notification.readAt),
  };
}

export function myHouseDTO(house: House, members: readonly User[], rooms: readonly Room[], photoURL: PhotoURL = noPhotos): MyHouseDTO {
  return { house: houseDTO(house), members: members.map((member) => userDTO(member, photoURL)), rooms: rooms.map(roomDTO) };
}

/** Snapshot agregado para as telas do app. Os DTOs continuam sem detalhes internos do agendamento. */
export function houseSnapshotDTO(snapshot: HouseSnapshot, photoURL: PhotoURL = noPhotos) {
  return {
    userID: snapshot.userID,
    home: myHouseDTO(snapshot.house, snapshot.members, snapshot.rooms, photoURL),
    participations: snapshot.participations.map(roomParticipationDTO),
    roomTasks: snapshot.roomTasks.map((item) => taskItemDTO(item, photoURL)),
    myTasks: snapshot.myTasks.map((item) => taskItemDTO(item, photoURL)),
    sporadicTasks: snapshot.sporadicTasks.map((item) => taskItemDTO(item, photoURL)),
    pendingRoomAccessIDs: [...snapshot.pendingRoomAccessIDs],
  };
}
