import Foundation

struct CreateRoomUseCase: Sendable {
    let roomRepository: any RoomRepository
    let houseRepository: any HouseRepository
    var calendar: Calendar = Calendar(identifier: .gregorian)

    func callAsFunction(
        name: String,
        houseID: House.ID,
        creatorUserID: User.ID,
        category: RoomCategory = .other,
        visibility: RoomVisibility,
        periodicity: WeeklyPeriodicity = WeeklyPeriodicity(),
        responsibleCount: Int = 1,
        icon: String = "house.fill",
        color: RoomColor = .blue,
        selectedParticipantIDs: Set<User.ID>? = nil,
        date: Date = .now
    ) async throws -> Room {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { throw DomainError.invalidRoomName }

        _ = try await houseRepository.house(id: houseID)
        let memberIDs = try await houseRepository.memberIDs(in: houseID)
        guard memberIDs.contains(creatorUserID) else { throw DomainError.invalidRoomParticipants }

        let participantIDs: [User.ID]
        switch visibility {
        case .common:
            participantIDs = memberIDs
        case .privateRoom:
            let selected = selectedParticipantIDs ?? [creatorUserID]
            guard selected.contains(creatorUserID), selected.isSubset(of: Set(memberIDs)) else {
                throw DomainError.invalidRoomParticipants
            }
            participantIDs = memberIDs.filter { selected.contains($0) }
        }

        guard periodicity.isValid, responsibleCount > 0 else { throw DomainError.invalidSchedule }
        let scheduler = TaskSchedulingService(calendar: calendar)
        let room = Room(
            id: UUID(), houseID: houseID, name: trimmedName, kind: .standard,
            category: category, visibility: visibility, periodicity: periodicity,
            responsibleCount: responsibleCount, calendarAnchor: try scheduler.weekStart(date),
            icon: icon, color: color
        )
        let memberships = participantIDs.map {
            RoomMembership(id: UUID(), roomID: room.id, userID: $0)
        }
        return try await roomRepository.create(room, memberships: memberships)
    }
}
