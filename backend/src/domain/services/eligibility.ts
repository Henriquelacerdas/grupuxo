import type { Instant } from "../dates.ts";
import {
  isActiveAssignment, isCompleted, isCurrentMember, type Absence, type HouseMembership, type Room, type RoomMembership,
  type TaskDefinition, type TaskItem,
} from "../entities.ts";
import type { UserID } from "../ids.ts";

export class TaskEligibilityPolicy {
  canView(_definition: TaskDefinition, room: Room, userID: UserID, roomMemberships: readonly RoomMembership[]): boolean {
    return roomMemberships.some((m) => m.roomID === room.id && m.userID === userID && isCurrentMember(m));
  }

  canClaim(item: TaskItem, room: Room, userID: UserID, roomMemberships: readonly RoomMembership[]): boolean {
    return item.definition.kind === "sporadic" && !isCompleted(item.occurrence) && item.assignment === null &&
      this.canView(item.definition, room, userID, roomMemberships);
  }
}

export class TaskSwapEligibilityPolicy {
  private readonly taskEligibility = new TaskEligibilityPolicy();

  canOffer(item: TaskItem, userID: UserID, date: Instant): boolean {
    const assignment = item.assignment;
    return assignment !== null && isActiveAssignment(assignment) && assignment.userID === userID &&
      !isCompleted(item.occurrence) && item.occurrence.availableAt <= date;
  }

  canReceive(
    item: TaskItem, room: Room, userID: UserID, houseMemberships: readonly HouseMembership[],
    roomMemberships: readonly RoomMembership[], absences: readonly Absence[], date: Instant,
  ): boolean {
    if (isCompleted(item.occurrence) || item.occurrence.availableAt > date) return false;
    const houseMembership = houseMemberships.find((m) => m.houseID === room.houseID && m.userID === userID);
    if (houseMembership === undefined) return false;
    const participatesInRoom = roomMemberships.some((m) => m.roomID === room.id && m.userID === userID && isCurrentMember(m));
    if (!participatesInRoom) return false;
    const isAbsent = absences.some((a) => a.membershipID === houseMembership.id && a.startsAt <= date && date < a.endsAt);
    if (isAbsent) return false;
    return this.taskEligibility.canView(item.definition, room, userID, roomMemberships);
  }

  canSwap(
    offeredItem: TaskItem, requestedItem: TaskItem, offeredRoom: Room, requestedRoom: Room, requesterID: UserID,
    receiverID: UserID, houseMemberships: readonly HouseMembership[], roomMemberships: readonly RoomMembership[],
    absences: readonly Absence[], date: Instant,
  ): boolean {
    if (requesterID === receiverID) return false;
    if (offeredItem.occurrence.id === requestedItem.occurrence.id) return false;
    if (!this.canOffer(offeredItem, requesterID, date)) return false;
    if (!this.canOffer(requestedItem, receiverID, date)) return false;
    if (!this.canReceive(requestedItem, requestedRoom, requesterID, houseMemberships, roomMemberships, absences, date)) {
      return false;
    }
    return this.canReceive(offeredItem, offeredRoom, receiverID, houseMemberships, roomMemberships, absences, date);
  }
}
