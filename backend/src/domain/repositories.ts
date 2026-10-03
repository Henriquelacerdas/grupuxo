import type { Instant } from "./dates.ts";
import type {
  AppNotification, House, Room, RoomMembership, RoomParticipation, TaskDefinition, TaskItem, TaskSwapRequest, User,
} from "./entities.ts";
import type {
  HouseID, NotificationID, RoomID, TaskOccurrenceID, TaskSwapRequestID, UserID,
} from "./ids.ts";

export interface HouseRepository {
  addMember(name: string, houseID: HouseID, requestedBy: UserID, at: Instant): Promise<User>;
  removeMember(userID: UserID, houseID: HouseID, requestedBy: UserID, at: Instant, confirmRoomDeletion: boolean): Promise<void>;
  house(id: HouseID): Promise<House>;
  houses(userID: UserID): Promise<House[]>;
  members(houseID: HouseID): Promise<User[]>;
  memberIDs(houseID: HouseID): Promise<UserID[]>;
}

export interface RoomRepository {
  participation(roomID: RoomID, requesting: UserID, at: Instant): Promise<RoomParticipation>;
  room(id: RoomID, requesting: UserID): Promise<Room>;
  rooms(houseID: HouseID, requesting: UserID): Promise<Room[]>;
  create(room: Room, memberships: readonly RoomMembership[]): Promise<Room>;
}

export interface TaskRepository {
  tasks(userID: UserID, houseID: HouseID): Promise<TaskItem[]>;
  roomTasks(roomID: RoomID, requesting: UserID): Promise<TaskItem[]>;
  sporadicTasks(houseID: HouseID, requesting: UserID): Promise<TaskItem[]>;
  create(definition: TaskDefinition, requestedBy: UserID, at: Instant): Promise<TaskDefinition>;
  refreshSchedule(houseID: HouseID, at: Instant): Promise<void>;
  addMember(userID: UserID, roomID: RoomID, at: Instant): Promise<void>;
  removeMember(userID: UserID, roomID: RoomID, at: Instant, confirmDeletion: boolean): Promise<void>;
  complete(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void>;
  reopen(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void>;
  claim(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void>;
  release(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void>;
}

export interface TaskSwapRepository {
  swapCandidates(requesterID: UserID, offering: TaskOccurrenceID, houseID: HouseID, at: Instant): Promise<TaskItem[]>;
  createRequest(
    requesterID: UserID, offered: TaskOccurrenceID, requested: TaskOccurrenceID, at: Instant,
  ): Promise<TaskSwapRequest>;
  incomingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]>;
  outgoingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]>;
  accept(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest>;
  reject(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest>;
}

export interface NotificationRepository {
  notifications(userID: UserID): Promise<AppNotification[]>;
  markAsRead(notificationID: NotificationID, by: UserID, at: Instant): Promise<void>;
}
