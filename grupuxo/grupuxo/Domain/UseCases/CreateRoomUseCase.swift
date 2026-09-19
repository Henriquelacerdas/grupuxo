//
//  CreateRoomUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 18/09/26.
//

import Foundation

struct CreateRoomUseCase: Sendable {

    let roomRepository: any RoomRepository
    let houseRepository: any HouseRepository

    func callAsFunction(
        name: String,
        houseID: House.ID
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

        guard !memberIDs.isEmpty else {
            throw DomainError.invalidRoomParticipants
        }

        let room = Room(
            id: UUID(),
            houseID: houseID,
            name: trimmedName,
            kind: .standard,
            visibility: .common,
            rotationPolicy: .weeklyCalendar
        )

        let memberships = memberIDs.map { userID in
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
