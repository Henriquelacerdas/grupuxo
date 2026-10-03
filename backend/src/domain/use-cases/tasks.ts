import type { Instant } from "../dates.ts";
import {
  isCompleted, sortedByDeadline, type TaskDefinition, type TaskItem, type TaskSuggestion,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, RoomID, TaskOccurrenceID, UserID } from "../ids.ts";
import type { TaskRepository } from "../repositories.ts";
import { TaskSuggestionCatalog } from "../services/task-suggestion-catalog.ts";
import { hasValidInterval, isRepeating, sameRecurrence, type RoomCategory } from "../value-objects.ts";
import { isBlank } from "../arrays.ts";

export type Clock = () => Instant;

export class GetMyTasksUseCase {
  private readonly repository: TaskRepository;
  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  /** Pendentes por prazo; concluídas por último. */
  async execute(userID: UserID, houseID: HouseID): Promise<TaskItem[]> {
    const tasks = sortedByDeadline(await this.repository.tasks(userID, houseID));
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
