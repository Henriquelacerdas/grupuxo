//
//  TaskSwapEligibilityPolicy.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct TaskSwapEligibilityPolicy: Sendable {

    private let taskEligibilityPolicy = TaskEligibilityPolicy()

    nonisolated func canOffer(
        _ item: TaskItem,
        by userID: User.ID,
        at date: Date
    ) -> Bool {

        guard
            let assignment = item.assignment,
            assignment.isActive,
            assignment.userID == userID,
            !item.occurrence.isCompleted,
            item.occurrence.availableAt <= date
        else {
            return false
        }

        return true
    }

    nonisolated func canReceive(
        _ item: TaskItem,
        room: Room,
        userID: User.ID,
        houseMemberships: [HouseMembership],
        roomMemberships: [RoomMembership],
        absences: [Absence],
        at date: Date
    ) -> Bool {

        guard
            !item.occurrence.isCompleted,
            item.occurrence.availableAt <= date
        else {
            return false
        }

        guard let houseMembership = houseMemberships.first(
            where: {
                $0.houseID == room.houseID
                    && $0.userID == userID
            }
        ) else {
            return false
        }

        let participatesInRoom = roomMemberships.contains {
            $0.roomID == room.id
                && $0.userID == userID
                && $0.isCurrent
        }

        guard participatesInRoom else {
            return false
        }

        let isAbsent = absences.contains {
            $0.membershipID == houseMembership.id
                && $0.startsAt <= date
                && date < $0.endsAt
        }

        guard !isAbsent else {
            return false
        }

        return taskEligibilityPolicy.canView(
            item.definition,
            room: room,
            userID: userID,
            roomMemberships: roomMemberships
        )
    }

    nonisolated func canSwap(
        offeredItem: TaskItem,
        requestedItem: TaskItem,
        offeredRoom: Room,
        requestedRoom: Room,
        requesterID: User.ID,
        receiverID: User.ID,
        houseMemberships: [HouseMembership],
        roomMemberships: [RoomMembership],
        absences: [Absence],
        at date: Date
    ) -> Bool {

        guard requesterID != receiverID else {
            return false
        }

        guard offeredItem.id != requestedItem.id else {
            return false
        }

        guard canOffer(
            offeredItem,
            by: requesterID,
            at: date
        ) else {
            return false
        }

        guard canOffer(
            requestedItem,
            by: receiverID,
            at: date
        ) else {
            return false
        }

        guard canReceive(
            requestedItem,
            room: requestedRoom,
            userID: requesterID,
            houseMemberships: houseMemberships,
            roomMemberships: roomMemberships,
            absences: absences,
            at: date
        ) else {
            return false
        }

        guard canReceive(
            offeredItem,
            room: offeredRoom,
            userID: receiverID,
            houseMemberships: houseMemberships,
            roomMemberships: roomMemberships,
            absences: absences,
            at: date
        ) else {
            return false
        }

        return true
    }
}
