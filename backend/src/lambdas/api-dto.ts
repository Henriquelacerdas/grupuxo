import { formatInstant, type Instant } from "../domain/dates.ts";
import type {
  House, Room, RoomParticipation, TaskAssignment, TaskDefinition, TaskItem, TaskOccurrence, User,
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
}

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

export interface MyHouseDTO {
  readonly house: HouseDTO;
  readonly members: readonly UserDTO[];
  readonly rooms: readonly RoomDTO[];
}

const iso = (instant: Instant): IsoInstant => formatInstant(instant);
const isoOrNull = (instant: Instant | null): IsoInstant | null => (instant === null ? null : iso(instant));

export function userDTO(user: User): UserDTO {
  return { id: user.id, name: user.name };
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
    responsibleNames: [...participation.responsibleNames], periodStart: iso(participation.periodStart),
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
    endedAt: isoOrNull(definition.endedAt),
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

export function taskItemDTO(item: TaskItem): TaskItemDTO {
  return {
    definition: taskDefinitionDTO(item.definition), occurrence: occurrenceDTO(item.occurrence),
    assignment: item.assignment === null ? null : assignmentDTO(item.assignment),
    assignee: item.assignee === null ? null : userDTO(item.assignee),
    suggestedAssignee: item.suggestedAssignee === null ? null : userDTO(item.suggestedAssignee),
  };
}

export function myHouseDTO(house: House, members: readonly User[], rooms: readonly Room[]): MyHouseDTO {
  return { house: houseDTO(house), members: members.map(userDTO), rooms: rooms.map(roomDTO) };
}
