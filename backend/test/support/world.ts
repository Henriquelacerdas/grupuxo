import { createSeed, type Seed } from "../../src/adapters/in-memory/seed.ts";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import {
  InMemoryHouseRepository, InMemoryNotificationRepository, InMemoryRoomRepository, InMemoryTaskRepository,
  InMemoryTaskSwapRepository,
} from "../../src/adapters/in-memory/repositories.ts";
import type { CommandContext } from "../../src/domain/commands/context.ts";
import { createCalendar, type Instant } from "../../src/domain/dates.ts";
import type { Room, TaskDefinition, TaskOccurrence } from "../../src/domain/entities.ts";
import { taskDefinitionID, type RoomID, type TaskOccurrenceID, type UserID } from "../../src/domain/ids.ts";
import { TaskSchedulingService } from "../../src/domain/services/task-scheduling-service.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import { cloneStoreState } from "../../src/domain/store-state.ts";
import { recurring, taskEffort, weeklyPeriodicity, type TaskAssignmentPolicy, type WeeklyPeriodicity } from "../../src/domain/value-objects.ts";
import type { RecurrencePolicy } from "../../src/domain/value-objects.ts";
import { sequentialIDs } from "./state-json.ts";

export interface WorldOptions {
  readonly timezone?: string;
  /** Referência da escala de demonstração (a semana dela). */
  readonly seedNow?: Instant;
}

/** Mundo de teste determinístico: relógio e IDs injetados, nunca o relógio real. */
export class World {
  readonly seed: Seed;
  readonly newID: () => string;
  readonly timezone: string;
  private current: Instant;

  constructor(options: WorldOptions = {}) {
    this.timezone = options.timezone ?? "UTC";
    this.current = options.seedNow ?? Date.UTC(2026, 8, 16, 12);
    this.newID = sequentialIDs();
    this.seed = createSeed({ now: this.current, newID: this.newID, timezone: this.timezone });
  }

  get now(): Instant {
    return this.current;
  }

  set now(value: Instant) {
    this.current = value;
  }

  get ctx(): CommandContext {
    return { now: () => this.current, newID: this.newID };
  }

  service(timezone: string = this.timezone): TaskSchedulingService {
    return new TaskSchedulingService({ calendar: createCalendar(timezone), newID: this.newID });
  }

  /** Estado da demonstração sem tarefas, com periodicidade 2 por semana nos cômodos (como o `fixture()` do Swift). */
  cleanState(periodicity: WeeklyPeriodicity = weeklyPeriodicity(2, 1), overrides: { responsibleCount?: number; anchor?: Instant | null } = {}): StoreState {
    const state = cloneStoreState(this.seed.state);
    state.definitions = [];
    state.occurrences = [];
    state.assignments = [];
    state.taskSwapRequests = [];
    state.notifications = [];
    state.rooms = state.rooms.map((room): Room => ({
      ...room, periodicity, calendarAnchor: overrides.anchor ?? null, scheduleVersions: [],
      responsibleCount: overrides.responsibleCount ?? room.responsibleCount,
    }));
    return state;
  }

  env(state: StoreState = this.seed.state): Env {
    const store = new InMemoryStore(state);
    const ctx = this.ctx;
    return {
      store, ctx,
      tasks: new InMemoryTaskRepository(store, ctx),
      rooms: new InMemoryRoomRepository(store, ctx),
      houses: new InMemoryHouseRepository(store, ctx),
      swaps: new InMemoryTaskSwapRepository(store, ctx),
      notifications: new InMemoryNotificationRepository(store),
    };
  }

  definition(roomID: RoomID, options: {
    effort?: number; recurrence?: RecurrencePolicy; policy?: TaskAssignmentPolicy; name?: string; kind?: TaskDefinition["kind"];
  } = {}): TaskDefinition {
    return {
      id: taskDefinitionID(this.newID()), roomID, name: options.name ?? "Limpar", details: "",
      effort: taskEffort(options.effort ?? 3), kind: options.kind ?? "recurring",
      recurrence: options.recurrence ?? recurring("weekly", 1), assignmentPolicy: options.policy ?? "calendarRotation",
      sourceSuggestionID: null, rotationQueue: [], currentRotationIndex: 0, nextScheduledAt: null,
      pendingRotation: null, calendarAnchor: null,
    };
  }
}

export interface Env {
  readonly store: InMemoryStore;
  readonly ctx: CommandContext;
  readonly tasks: InMemoryTaskRepository;
  readonly rooms: InMemoryRoomRepository;
  readonly houses: InMemoryHouseRepository;
  readonly swaps: InMemoryTaskSwapRepository;
  readonly notifications: InMemoryNotificationRepository;
}

export function activeOwner(state: Pick<StoreState, "assignments">, occurrence: TaskOccurrence | TaskOccurrenceID): UserID | undefined {
  const id = typeof occurrence === "string" ? occurrence : occurrence.id;
  return state.assignments.find((a) => a.occurrenceID === id && a.endedAt === null && a.supersededAt === null)?.userID;
}

/** UUIDs legíveis para testes: `uid(1)` = 00000000-0000-4000-8000-000000000001. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function permutations(values: readonly number[]): number[][] {
  const [first, ...rest] = values;
  if (first === undefined) return [[]];
  return permutations(rest).flatMap((tail) =>
    Array.from({ length: tail.length + 1 }, (_, index) => {
      const result = [...tail];
      result.splice(index, 0, first);
      return result;
    })
  );
}
