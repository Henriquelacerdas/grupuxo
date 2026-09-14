import Foundation

enum MockSeed {
    nonisolated static let currentUser = User(id: UUID(), name: "Morador", email: nil)
    nonisolated static let house = House(id: UUID(), name: "Nossa casa", accessCode: "GRUPUXO", createdAt: .now)
    nonisolated static let wholeHouseRoom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Casa toda",
        kind: .wholeHouse,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static var rooms: [Room] {
        [
            wholeHouseRoom,
            Room(id: UUID(), houseID: house.id, name: "Cozinha", kind: .standard, visibility: .common, rotationPolicy: .weeklyCalendar),
            Room(id: UUID(), houseID: house.id, name: "Banheiro", kind: .standard, visibility: .common, rotationPolicy: .weeklyCalendar)
        ]
    }

    nonisolated static func make() -> MockStore.State {
        let seededRooms = rooms
        let definition = TaskDefinition(
            id: UUID(),
            roomID: seededRooms[1].id,
            name: "Lavar a louça",
            details: "Tarefa de exemplo dos dados locais.",
            effort: TaskEffort(points: 2),
            kind: .recurring,
            visibility: .house,
            recurrence: .weekly(interval: 1),
            assignmentPolicy: .balancedAutomatically,
            ownerUserID: nil
        )
        let occurrence = TaskOccurrence(
            id: UUID(),
            taskDefinitionID: definition.id,
            availableAt: .now,
            dueAt: nil,
            status: .available,
            completedAt: nil,
            completedByUserID: nil,
            effortSnapshot: definition.effort
        )
        return MockStore.State(
            users: [currentUser],
            houses: [house],
            houseMemberships: [HouseMembership(id: UUID(), houseID: house.id, userID: currentUser.id)],
            rooms: seededRooms,
            roomMemberships: [],
            definitions: [definition],
            occurrences: [occurrence],
            assignments: [],
            absences: [],
            roomAccessRequests: []
        )
    }
}
