import Foundation

enum MockSeed {

    // Quatro moradores tornam visíveis a rotação e o balanceamento de esforço.
    nonisolated static let currentUser = User(
        id: UUID(),
        name: "Marina",
        email: "marina@grupuxo.local"
    )

    nonisolated static let leo = User(
        id: UUID(),
        name: "Leo",
        email: "leo@grupuxo.local"
    )

    nonisolated static let bia = User(
        id: UUID(),
        name: "Bia",
        email: "bia@grupuxo.local"
    )

    nonisolated static let rafa = User(
        id: UUID(),
        name: "Rafa",
        email: "rafa@grupuxo.local"
    )

    nonisolated static let users = [
        currentUser,
        leo,
        bia,
        rafa
    ]

    nonisolated static let house = House(
        id: UUID(),
        name: "Nossa casa",
        accessCode: "GRUPUXO",
        createdAt: .now
    )

    nonisolated static let wholeHouseRoom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Casa toda",
        kind: .wholeHouse,
        category: .other,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static let kitchen = Room(
        id: UUID(),
        houseID: house.id,
        name: "Cozinha",
        kind: .standard,
        category: .kitchen,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static let bathroom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Banheiro",
        kind: .standard,
        category: .bathroom,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static let livingRoom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Sala",
        kind: .standard,
        category: .livingRoom,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static let laundry = Room(
        id: UUID(),
        houseID: house.id,
        name: "Lavanderia",
        kind: .standard,
        category: .laundry,
        visibility: .common,
        rotationPolicy: .weeklyCalendar
    )

    nonisolated static let privateOffice = Room(
        id: UUID(),
        houseID: house.id,
        name: "Escritório privado",
        kind: .standard,
        category: .office,
        visibility: .privateRoom,
        rotationPolicy: .none
    )

    nonisolated static let rooms = [
        wholeHouseRoom,
        kitchen,
        bathroom,
        livingRoom,
        laundry,
        privateOffice
    ]

    nonisolated static func make() -> MockStore.State {

        let seededRooms = rooms

        let memberships = users.map {
            HouseMembership(
                id: UUID(),
                houseID: house.id,
                userID: $0.id
            )
        }

        let commonMemberships = seededRooms
            .filter { $0.visibility == .common }
            .flatMap { room in

                users.map {
                    RoomMembership(
                        id: UUID(),
                        roomID: room.id,
                        userID: $0.id
                    )
                }
            }

        let privateMemberships = [
            currentUser,
            bia
        ].map {
            RoomMembership(
                id: UUID(),
                roomID: privateOffice.id,
                userID: $0.id
            )
        }

        let definitions = [

            definition(
                "Lavar a louça",
                "Limpar pia e escorredor",
                room: kitchen,
                effort: 2,
                policy: .balancedAutomatically
            ),

            definition(
                "Limpar bancada",
                "Passar pano e retirar migalhas",
                room: kitchen,
                effort: 1,
                policy: .afterCompletion
            ),

            definition(
                "Higienizar o banheiro",
                "Vaso, pia e espelho",
                room: bathroom,
                effort: 3,
                policy: .calendarRotation
            ),

            definition(
                "Repor papel higiênico",
                "Conferir o armário",
                room: bathroom,
                effort: 1,
                policy: .balancedAutomatically
            ),

            definition(
                "Aspirar a sala",
                "Incluindo embaixo do sofá",
                room: livingRoom,
                effort: 2,
                policy: .calendarRotation
            ),

            definition(
                "Tirar o lixo",
                "Separar recicláveis",
                room: wholeHouseRoom,
                effort: 1,
                policy: .balancedAutomatically
            ),

            definition(
                "Lavar roupas de cama",
                "Trocar e lavar os lençóis",
                room: laundry,
                effort: 2,
                policy: .afterCompletion
            ),

            definition(
                "Organizar documentos",
                "Tarefa do escritório privado",
                room: privateOffice,
                effort: 1,
                policy: .selfAssigned,
                visibility: .privateTask
            ),

            definition(
                "Trocar a lâmpada da sala",
                "Tarefa avulsa de manutenção",
                room: livingRoom,
                effort: 2,
                kind: .sporadic,
                policy: .selfAssigned
            )
        ]

        let occurrences = definitions.enumerated().map { index, item in

            TaskOccurrence(
                id: UUID(),
                taskDefinitionID: item.id,
                availableAt: .now.addingTimeInterval(
                    TimeInterval(-index * 3600)
                ),
                dueAt: item.kind == .recurring
                    ? .now.addingTimeInterval(7 * 86_400)
                    : nil,
                status: .available,
                completedAt: nil,
                completedByUserID: nil,
                effortSnapshot: item.effort
            )
        }

        let assignments = [

            TaskAssignment(
                id: UUID(),
                occurrenceID: occurrences[0].id,
                userID: currentUser.id,
                assignedAt: .now,
                endedAt: nil
            ),

            TaskAssignment(
                id: UUID(),
                occurrenceID: occurrences[2].id,
                userID: leo.id,
                assignedAt: .now,
                endedAt: nil
            ),

            TaskAssignment(
                id: UUID(),
                occurrenceID: occurrences[4].id,
                userID: bia.id,
                assignedAt: .now,
                endedAt: nil
            ),

            TaskAssignment(
                id: UUID(),
                occurrenceID: occurrences[5].id,
                userID: rafa.id,
                assignedAt: .now,
                endedAt: nil
            )
        ]

        var seededOccurrences = occurrences

        for assignment in assignments {

            if let index = seededOccurrences.firstIndex(
                where: {
                    $0.id == assignment.occurrenceID
                }
            ) {
                seededOccurrences[index].status = .assigned
            }
        }

        return MockStore.State(
            users: users,
            houses: [house],
            houseMemberships: memberships,
            rooms: seededRooms,
            roomMemberships: commonMemberships + privateMemberships,
            definitions: definitions,
            occurrences: seededOccurrences,
            assignments: assignments,
            absences: [],
            roomAccessRequests: []
        )
    }

    private nonisolated static func definition(
        _ name: String,
        _ details: String,
        room: Room,
        effort: Int,
        kind: TaskKind = .recurring,
        policy: TaskAssignmentPolicy,
        visibility: TaskVisibility = .house
    ) -> TaskDefinition {

        TaskDefinition(
            id: UUID(),
            roomID: room.id,
            name: name,
            details: details,
            effort: TaskEffort(
                points: effort
            ),
            kind: kind,
            visibility: visibility,
            recurrence: kind == .recurring
                ? .recurring(
                    frequency: .weekly,
                    interval: 1
                )
                : .none,
            assignmentPolicy: policy,
            ownerUserID: visibility == .privateTask
                ? currentUser.id
                : nil
        )
    }
}
