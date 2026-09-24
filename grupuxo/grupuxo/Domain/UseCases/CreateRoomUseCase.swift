//
//  CreateRoomUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 18/09/26.
//
//


import Foundation

struct CreateRoomUseCase: Sendable {

    let roomRepository: any RoomRepository
    let houseRepository: any HouseRepository

    func callAsFunction(
        name: String,
        houseID: House.ID,
        creatorUserID: User.ID,
        category: RoomCategory = .other,
        visibility: RoomVisibility
    ) async throws -> Room {

        let trimmedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard !trimmedName.isEmpty else {
            throw DomainError.invalidRoomName
        }

        _ = try await houseRepository.house(id: houseID)

        let memberIDs = try await houseRepository.memberIDs(
            in: houseID
        )

        guard memberIDs.contains(creatorUserID) else {
            throw DomainError.invalidRoomParticipants
        }

        let participantIDs: [User.ID]

        switch visibility {

        case .common:
            participantIDs = memberIDs

        case .privateRoom:
            participantIDs = [creatorUserID]
        }

        let rotationPolicy: RoomRotationPolicy =
            visibility == .common
            ? .weeklyCalendar
            : .none

        let room = Room(
            id: UUID(),
            houseID: houseID,
            name: trimmedName,
            kind: .standard,
            category: category,
            visibility: visibility,
            rotationPolicy: rotationPolicy
        )

        let memberships = participantIDs.map { userID in

            RoomMembership(
                id: UUID(),
                roomID: room.id,
                userID: userID
            )
        }

        return try await roomRepository.create(
            room,
            memberships: memberships
        )
    }
}
