import type { Instant } from "../dates.ts";
import type { AppNotification, TaskItem, TaskSwapRequest } from "../entities.ts";
import type { HouseID, NotificationID, TaskOccurrenceID, TaskSwapRequestID, UserID } from "../ids.ts";
import type { NotificationRepository, TaskSwapRepository } from "../repositories.ts";
import type { Clock } from "./tasks.ts";

export class GetTaskSwapCandidatesUseCase {
  private readonly repository: TaskSwapRepository;
  private readonly now: Clock;
  constructor(repository: TaskSwapRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(requesterID: UserID, offeredOccurrenceID: TaskOccurrenceID, houseID: HouseID, date?: Instant): Promise<TaskItem[]> {
    return this.repository.swapCandidates(requesterID, offeredOccurrenceID, houseID, date ?? this.now());
  }
}

export class CreateTaskSwapRequestUseCase {
  private readonly repository: TaskSwapRepository;
  private readonly now: Clock;
  constructor(repository: TaskSwapRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(
    requesterID: UserID, offeredOccurrenceID: TaskOccurrenceID, requestedOccurrenceID: TaskOccurrenceID, date?: Instant,
  ): Promise<TaskSwapRequest> {
    return this.repository.createRequest(requesterID, offeredOccurrenceID, requestedOccurrenceID, date ?? this.now());
  }
}

export class AcceptTaskSwapRequestUseCase {
  private readonly repository: TaskSwapRepository;
  private readonly now: Clock;
  constructor(repository: TaskSwapRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(requestID: TaskSwapRequestID, userID: UserID, date?: Instant): Promise<TaskSwapRequest> {
    return this.repository.accept(requestID, userID, date ?? this.now());
  }
}

export class RejectTaskSwapRequestUseCase {
  private readonly repository: TaskSwapRepository;
  private readonly now: Clock;
  constructor(repository: TaskSwapRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(requestID: TaskSwapRequestID, userID: UserID, date?: Instant): Promise<TaskSwapRequest> {
    return this.repository.reject(requestID, userID, date ?? this.now());
  }
}

export class GetIncomingTaskSwapRequestsUseCase {
  private readonly repository: TaskSwapRepository;
  constructor(repository: TaskSwapRepository) {
    this.repository = repository;
  }

  execute(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.repository.incomingRequests(userID, houseID);
  }
}

export class GetOutgoingTaskSwapRequestsUseCase {
  private readonly repository: TaskSwapRepository;
  constructor(repository: TaskSwapRepository) {
    this.repository = repository;
  }

  execute(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]> {
    return this.repository.outgoingRequests(userID, houseID);
  }
}

export class GetNotificationsUseCase {
  private readonly repository: NotificationRepository;
  constructor(repository: NotificationRepository) {
    this.repository = repository;
  }

  execute(userID: UserID): Promise<AppNotification[]> {
    return this.repository.notifications(userID);
  }
}

export class MarkNotificationAsReadUseCase {
  private readonly repository: NotificationRepository;
  private readonly now: Clock;
  constructor(repository: NotificationRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(notificationID: NotificationID, userID: UserID, date?: Instant): Promise<void> {
    return this.repository.markAsRead(notificationID, userID, date ?? this.now());
  }
}
