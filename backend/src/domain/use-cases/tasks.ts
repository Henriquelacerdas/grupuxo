import { createCalendar, type Instant } from "../dates.ts";
import {
  isCompleted, sortedByDeadline, type TaskDefinition, type TaskItem, type TaskOccurrence, type TaskSuggestion,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, RoomID, TaskOccurrenceID, UserID } from "../ids.ts";
import type { HouseRepository, TaskRepository } from "../repositories.ts";
import { TaskSuggestionCatalog } from "../services/task-suggestion-catalog.ts";
import { hasValidInterval, isRepeating, sameRecurrence, type RoomCategory } from "../value-objects.ts";
import { isBlank } from "../arrays.ts";

export type Clock = () => Instant;

/** `week`: só a semana corrente da casa; `all`: tudo o que já está disponível para o morador. */
export type TaskRange = "week" | "all";

/**
 * A ocorrência ocupa o intervalo semiaberto `[availableAt, dueAt)` (sem prazo, fica aberta até ser concluída), então
 * um prazo exatamente na virada da semana pertence à semana anterior. Concluída sem prazo só conta na semana em que
 * foi concluída. Atrasadas de semanas anteriores ficam de fora.
 */
function overlapsWeek(occurrence: TaskOccurrence, weekStart: Instant, weekEnd: Instant): boolean {
  if (occurrence.availableAt >= weekEnd) return false;
  if (occurrence.dueAt !== null) return occurrence.dueAt > weekStart;
  if (!isCompleted(occurrence)) return true;
  return occurrence.completedAt !== null && occurrence.completedAt >= weekStart && occurrence.completedAt < weekEnd;
}

export class GetMyTasksUseCase {
  private readonly repository: Pick<TaskRepository, "tasks">;
  private readonly houses: Pick<HouseRepository, "house">;
  private readonly now: Clock;
  constructor(repository: Pick<TaskRepository, "tasks">, houses: Pick<HouseRepository, "house">, now: Clock) {
    this.repository = repository;
    this.houses = houses;
    this.now = now;
  }

  /** Pendentes por prazo; concluídas por último. A semana começa na segunda 00:00 do fuso da casa (`House.timezone`). */
  async execute(userID: UserID, houseID: HouseID, range: TaskRange = "all"): Promise<TaskItem[]> {
    let items = await this.repository.tasks(userID, houseID);
    if (range === "week") {
      const calendar = createCalendar((await this.houses.house(houseID)).timezone);
      const weekStart = calendar.weekStart(this.now());
      const weekEnd = calendar.addWeeks(weekStart, 1);
      items = items.filter((t) => overlapsWeek(t.occurrence, weekStart, weekEnd));
    }
    const tasks = sortedByDeadline(items);
    return [...tasks.filter((t) => !isCompleted(t.occurrence)), ...tasks.filter((t) => isCompleted(t.occurrence))];
  }
}

export class GetRoomTasksUseCase {
  private readonly repository: TaskRepository;
  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  async execute(roomID: RoomID, userID: UserID): Promise<TaskItem[]> {
    return sortedByDeadline(await this.repository.roomTasks(roomID, userID));
  }
}

export class GetSporadicTasksUseCase {
  private readonly repository: TaskRepository;
  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  async execute(houseID: HouseID, userID: UserID): Promise<TaskItem[]> {
    return sortedByDeadline(await this.repository.sporadicTasks(houseID, userID));
  }
}

export class GetTaskSuggestionsUseCase {
  private readonly catalog: TaskSuggestionCatalog;
  constructor(catalog: TaskSuggestionCatalog = new TaskSuggestionCatalog()) {
    this.catalog = catalog;
  }

  execute(category: RoomCategory): readonly TaskSuggestion[] {
    return this.catalog.suggestions(category);
  }
}

export class CreateTaskUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(definition: TaskDefinition, requestedBy: UserID, date?: Instant): Promise<TaskDefinition> {
    if (isBlank(definition.name)) throw new DomainError("invalidTaskName");
    if (!hasValidInterval(definition.recurrence)) throw new DomainError("invalidSchedule");
    switch (definition.kind) {
      case "sporadic":
        if (!sameRecurrence(definition.recurrence, { kind: "none" }) || definition.assignmentPolicy !== "selfAssigned") {
          throw new DomainError("invalidSchedule");
        }
        break;
      case "recurring":
        if (definition.assignmentPolicy === "selfAssigned" ||
          !(definition.assignmentPolicy === "afterCompletion" || isRepeating(definition.recurrence))) {
          throw new DomainError("invalidSchedule");
        }
        break;
    }
    // O repositório grava o plano sobre o mesmo snapshot usado na otimização.
    return this.repository.create(definition, requestedBy, date ?? this.now());
  }
}

export class CompleteTaskUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  /** `isCompleted: false` desfaz a conclusão (reabrir). */
  async execute(occurrenceID: TaskOccurrenceID, userID: UserID, options: { date?: Instant; isCompleted?: boolean } = {}): Promise<void> {
    if (options.isCompleted ?? true) {
      await this.repository.complete(occurrenceID, userID, options.date ?? this.now());
    } else {
      await this.repository.reopen(occurrenceID, userID);
    }
  }
}

export class ClaimSporadicTaskUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(occurrenceID: TaskOccurrenceID, userID: UserID, date?: Instant): Promise<void> {
    await this.repository.claim(occurrenceID, userID, date ?? this.now());
  }
}

export class ReleaseSporadicTaskUseCase {
  private readonly repository: TaskRepository;
  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  async execute(occurrenceID: TaskOccurrenceID, userID: UserID): Promise<void> {
    await this.repository.release(occurrenceID, userID);
  }
}

export class RefreshTaskScheduleUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(houseID: HouseID, date?: Instant): Promise<void> {
    await this.repository.refreshSchedule(houseID, date ?? this.now());
  }
}

export class AddRoomMemberUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(userID: UserID, roomID: RoomID, date?: Instant): Promise<void> {
    await this.repository.addMember(userID, roomID, date ?? this.now());
  }
}

export class RemoveRoomMemberUseCase {
  private readonly repository: TaskRepository;
  private readonly now: Clock;
  constructor(repository: TaskRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(userID: UserID, roomID: RoomID, options: { date?: Instant; confirmDeletion?: boolean } = {}): Promise<void> {
    await this.repository.removeMember(userID, roomID, options.date ?? this.now(), options.confirmDeletion ?? false);
  }
}
