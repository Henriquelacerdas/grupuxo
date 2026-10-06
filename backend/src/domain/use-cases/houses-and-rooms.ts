import { isBlank, trimmed } from "../arrays.ts";
import { createCalendar, type Instant } from "../dates.ts";
import type { Room, RoomParticipation, User } from "../entities.ts";
import { DomainError } from "../errors.ts";
import { roomID as toRoomID, roomMembershipID, type HouseID, type IDGenerator, type RoomID, type UserID } from "../ids.ts";
import type { HouseRepository, RoomRepository } from "../repositories.ts";
import { isValidPeriodicity, weeklyPeriodicity, type RoomCategory, type RoomColor, type RoomVisibility, type WeeklyPeriodicity } from "../value-objects.ts";
import type { Clock } from "./tasks.ts";

export class GetHouseMembersUseCase {
  private readonly repository: HouseRepository;
  constructor(repository: HouseRepository) {
    this.repository = repository;
  }

  async execute(houseID: HouseID, userID: UserID): Promise<User[]> {
    if (!(await this.repository.memberIDs(houseID)).includes(userID)) throw new DomainError("taskUnavailable");
    return this.repository.members(houseID);
  }
}

export class AddHouseMemberUseCase {
  private readonly repository: HouseRepository;
  private readonly now: Clock;
  constructor(repository: HouseRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(name: string, houseID: HouseID, requestedBy: UserID, date?: Instant): Promise<User> {
    if (isBlank(name)) throw new DomainError("invalidResidentName");
    return this.repository.addMember(trimmed(name), houseID, requestedBy, date ?? this.now());
  }
}

export class RemoveHouseMemberUseCase {
  private readonly repository: HouseRepository;
  private readonly now: Clock;
  constructor(repository: HouseRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(
    userID: UserID, houseID: HouseID, requestedBy: UserID, options: { date?: Instant; confirmRoomDeletion?: boolean } = {},
  ): Promise<void> {
    if (userID === requestedBy) throw new DomainError("cannotRemoveCurrentUser");
    await this.repository.removeMember(userID, houseID, requestedBy, options.date ?? this.now(), options.confirmRoomDeletion ?? false);
  }
}

export class GetHouseRoomsUseCase {
  private readonly repository: RoomRepository;
  private readonly now: Clock;
  constructor(repository: RoomRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  async execute(houseID: HouseID, userID: UserID, participatingOnly = false): Promise<Room[]> {
    const rooms = await this.repository.rooms(houseID, userID);
    if (!participatingOnly) return rooms;
    const result: Room[] = [];
    for (const room of rooms) {
      if ((await this.repository.participation(room.id, userID, this.now())).isMember) result.push(room);
    }
    return result;
  }
}

export class GetRoomParticipationUseCase {
  private readonly repository: RoomRepository;
  private readonly now: Clock;
  constructor(repository: RoomRepository, now: Clock) {
    this.repository = repository;
    this.now = now;
  }

  execute(roomID: RoomID, userID: UserID): Promise<RoomParticipation> {
    return this.repository.participation(roomID, userID, this.now());
  }
}

export interface CreateRoomInput {
  readonly name: string;
  readonly houseID: HouseID;
  readonly creatorUserID: UserID;
  readonly category?: RoomCategory;
  readonly visibility: RoomVisibility;
  readonly periodicity?: WeeklyPeriodicity;
  readonly responsibleCount?: number;
  readonly icon?: string;
  readonly color?: RoomColor;
  readonly selectedParticipantIDs?: ReadonlySet<UserID> | null;
  readonly date?: Instant;
}

export class CreateRoomUseCase {
  private readonly roomRepository: RoomRepository;
  private readonly houseRepository: HouseRepository;
  private readonly now: Clock;
  private readonly newID: IDGenerator;
  constructor(roomRepository: RoomRepository, houseRepository: HouseRepository, now: Clock, newID: IDGenerator) {
    this.roomRepository = roomRepository;
    this.houseRepository = houseRepository;
    this.now = now;
    this.newID = newID;
  }

  async execute(input: CreateRoomInput): Promise<Room> {
    if (isBlank(input.name)) throw new DomainError("invalidRoomName");
    const house = await this.houseRepository.house(input.houseID);
    const memberIDs = await this.houseRepository.memberIDs(input.houseID);
    if (!memberIDs.includes(input.creatorUserID)) throw new DomainError("invalidRoomParticipants");
    let participantIDs: UserID[];
    switch (input.visibility) {
      case "common":
        participantIDs = memberIDs;
        break;
      case "privateRoom": {
        const selected = input.selectedParticipantIDs ?? new Set([input.creatorUserID]);
        if (!selected.has(input.creatorUserID) || ![...selected].every((u) => memberIDs.includes(u))) {
          throw new DomainError("invalidRoomParticipants");
        }
        participantIDs = memberIDs.filter((u) => selected.has(u));
        break;
      }
    }
    const periodicity = input.periodicity ?? weeklyPeriodicity();
    const responsibleCount = input.responsibleCount ?? 1;
    if (!isValidPeriodicity(periodicity) || responsibleCount <= 0) throw new DomainError("invalidSchedule");
    const date = input.date ?? this.now();
    const room: Room = {
      id: toRoomID(this.newID()), houseID: input.houseID, name: trimmed(input.name), kind: "standard",
      category: input.category ?? "other", visibility: input.visibility, periodicity, responsibleCount,
      calendarAnchor: createCalendar(house.timezone).weekStart(date), scheduleVersions: [],
      icon: input.icon ?? "house.fill", color: input.color ?? "blue",
    };
    const memberships = participantIDs.map((userID) => ({
      id: roomMembershipID(this.newID()), roomID: room.id, userID, fairnessDebt: 0, leftAt: null, rotationChanges: null,
    }));
    return this.roomRepository.create(room, memberships);
  }
}
