import { createCalendar, type Instant } from "../../domain/dates.ts";
import type { House, Room, TaskDefinition, User } from "../../domain/entities.ts";
import {
  houseID as toHouseID, houseMembershipID, roomID as toRoomID, roomMembershipID, taskDefinitionID, userID as toUserID,
  type IDGenerator,
} from "../../domain/ids.ts";
import { TaskSchedulingService } from "../../domain/services/task-scheduling-service.ts";
import type { StoreState } from "../../domain/store-state.ts";
import {
  NO_RECURRENCE, recurring, taskEffort, weeklyPeriodicity, type RoomCategory, type RoomColor, type RoomKind,
  type RoomVisibility, type TaskAssignmentPolicy, type TaskKind,
} from "../../domain/value-objects.ts";

export interface SeedOptions {
  /** A escala de demonstração começa na segunda-feira da semana de `now`. */
  readonly now: Instant;
  readonly newID: IDGenerator;
  /** Fuso da casa de demonstração. */
  readonly timezone?: string;
}

export interface Seed {
  readonly state: StoreState;
  readonly users: { readonly marina: User; readonly leo: User; readonly bia: User; readonly rafa: User };
  readonly currentUser: User;
  readonly house: House;
  readonly rooms: {
    readonly wholeHouse: Room; readonly kitchen: Room; readonly bathroom: Room; readonly livingRoom: Room;
    readonly laundry: Room; readonly privateOffice: Room;
  };
}

/** Dados de demonstração, gerados pelo mesmo planejador dos comandos reais (equivale ao `MockSeed` do app). */
export function createSeed(options: SeedOptions): Seed {
  const { newID } = options;
  const user = (name: string, email: string): User => ({ id: toUserID(newID()), name, email });
  const marina = user("Marina", "marina@grupuxo.local");
  const leo = user("Leo", "leo@grupuxo.local");
  const bia = user("Bia", "bia@grupuxo.local");
  const rafa = user("Rafa", "rafa@grupuxo.local");
  const users = [marina, leo, bia, rafa];
  const house: House = {
    id: toHouseID(newID()), name: "Nossa casa", accessCode: "GRUPUXO", createdAt: options.now,
    timezone: options.timezone ?? "America/Sao_Paulo",
  };
  const room = (
    name: string, kind: RoomKind, category: RoomCategory, visibility: RoomVisibility, icon: string, color: RoomColor,
  ): Room => ({
    id: toRoomID(newID()), houseID: house.id, name, kind, category, visibility, periodicity: weeklyPeriodicity(),
    responsibleCount: 1, calendarAnchor: null, scheduleVersions: [], icon, color,
  });
  const wholeHouse = room("Casa toda", "wholeHouse", "other", "common", "house.fill", "blue");
  const kitchen = room("Cozinha", "standard", "kitchen", "common", "refrigerator.fill", "orange");
  const bathroom = room("Banheiro", "standard", "bathroom", "common", "shower.fill", "purple");
  const livingRoom = room("Sala", "standard", "livingRoom", "common", "sofa.fill", "green");
  const laundry = room("Lavanderia", "standard", "laundry", "common", "washer.fill", "pink");
  const privateOffice = room("Escritório privado", "standard", "office", "privateRoom", "display", "brown");
  const rooms = [wholeHouse, kitchen, bathroom, livingRoom, laundry, privateOffice];

  const roomMemberships = [
    ...rooms.filter((r) => r.visibility === "common").flatMap((r) =>
      users.map((u) => ({
        id: roomMembershipID(newID()), roomID: r.id, userID: u.id, fairnessDebt: 0, leftAt: null, rotationChanges: null,
      }))
    ),
    ...[marina, bia].map((u) => ({
      id: roomMembershipID(newID()), roomID: privateOffice.id, userID: u.id, fairnessDebt: 0, leftAt: null, rotationChanges: null,
    })),
  ];

  const definition = (
    name: string, details: string, inRoom: Room, effort: number, policy: TaskAssignmentPolicy, kind: TaskKind = "recurring",
  ): TaskDefinition => ({
    id: taskDefinitionID(newID()), roomID: inRoom.id, name, details, effort: taskEffort(effort), kind,
    recurrence: kind === "recurring" ? recurring("weekly", 1) : NO_RECURRENCE, assignmentPolicy: policy,
    sourceSuggestionID: null, rotationQueue: [], currentRotationIndex: 0, nextScheduledAt: null,
    pendingRotation: null, calendarAnchor: null,
  });
  const definitions = [
    definition("Lavar a louça", "Limpar pia e escorredor", kitchen, 2, "balancedAutomatically"),
    definition("Limpar bancada", "Passar pano e retirar migalhas", kitchen, 1, "afterCompletion"),
    definition("Higienizar o banheiro", "Vaso, pia e espelho", bathroom, 3, "calendarRotation"),
    definition("Repor papel higiênico", "Conferir o armário", bathroom, 1, "balancedAutomatically"),
    definition("Aspirar a sala", "Incluindo embaixo do sofá", livingRoom, 2, "calendarRotation"),
    definition("Tirar o lixo", "Separar recicláveis", wholeHouse, 1, "balancedAutomatically"),
    definition("Lavar roupas de cama", "Trocar e lavar os lençóis", laundry, 2, "afterCompletion"),
    definition("Organizar documentos", "Tarefa do escritório privado", privateOffice, 1, "calendarRotation"),
    definition("Trocar a lâmpada da sala", "Tarefa avulsa de manutenção", livingRoom, 2, "selfAssigned", "sporadic"),
  ];

  const state: StoreState = {
    users, houses: [house],
    houseMemberships: users.map((u) => ({ id: houseMembershipID(newID()), houseID: house.id, userID: u.id })),
    rooms, roomMemberships, definitions: [], occurrences: [], assignments: [], absences: [],
    taskSwapRequests: [], notifications: [],
  };
  const scheduling = new TaskSchedulingService({ calendar: createCalendar(house.timezone), newID });
  const start = scheduling.weekStart(options.now);
  for (const d of definitions) scheduling.create(d, start, state);
  return { state, users: { marina, leo, bia, rafa }, currentUser: marina, house, rooms: {
    wholeHouse, kitchen, bathroom, livingRoom, laundry, privateOffice,
  } };
}
