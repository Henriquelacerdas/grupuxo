import Foundation

enum MockSeed {
    // Quatro moradores tornam visíveis a rotação e o balanceamento de esforço.
    nonisolated static let currentUser = User(id: UUID(), name: "Marina", email: "marina@grupuxo.local")
    nonisolated static let leo = User(id: UUID(), name: "Leo", email: "leo@grupuxo.local")
    nonisolated static let bia = User(id: UUID(), name: "Bia", email: "bia@grupuxo.local")
    nonisolated static let rafa = User(id: UUID(), name: "Rafa", email: "rafa@grupuxo.local")
    nonisolated static let users = [currentUser, leo, bia, rafa]
    nonisolated static let house = House(id: UUID(), name: "Nossa casa", accessCode: "GRUPUXO", createdAt: .now)
    nonisolated static let wholeHouseRoom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Casa toda",
        kind: .wholeHouse,
        visibility: .common
    )

    nonisolated static let kitchen = Room(id: UUID(), houseID: house.id, name: "Cozinha", kind: .standard, visibility: .common)
    nonisolated static let bathroom = Room(id: UUID(), houseID: house.id, name: "Banheiro", kind: .standard, visibility: .common)
    nonisolated static let livingRoom = Room(id: UUID(), houseID: house.id, name: "Sala", kind: .standard, visibility: .common)
    nonisolated static let laundry = Room(id: UUID(), houseID: house.id, name: "Lavanderia", kind: .standard, visibility: .common)
    nonisolated static let privateOffice = Room(id: UUID(), houseID: house.id, name: "Escritório privado", kind: .standard, visibility: .privateRoom)
    nonisolated static let rooms = [wholeHouseRoom, kitchen, bathroom, livingRoom, laundry, privateOffice]

    nonisolated static func make() -> MockStore.State {
        let seededRooms = rooms
        let memberships = users.map { HouseMembership(id: UUID(), houseID: house.id, userID: $0.id) }
        let commonMemberships = seededRooms.filter { $0.visibility == .common }.flatMap { room in
            users.map { RoomMembership(id: UUID(), roomID: room.id, userID: $0.id) }
        }
        let privateMemberships = [currentUser, bia].map { RoomMembership(id: UUID(), roomID: privateOffice.id, userID: $0.id) }
        let definitions = [
            definition("Lavar a louça", "Limpar pia e escorredor", room: kitchen, effort: 2, policy: .balancedAutomatically),
            definition("Limpar bancada", "Passar pano e retirar migalhas", room: kitchen, effort: 1, policy: .afterCompletion),
            definition("Higienizar o banheiro", "Vaso, pia e espelho", room: bathroom, effort: 3, policy: .calendarRotation),
            definition("Repor papel higiênico", "Conferir o armário", room: bathroom, effort: 1, policy: .balancedAutomatically),
            definition("Aspirar a sala", "Incluindo embaixo do sofá", room: livingRoom, effort: 2, policy: .calendarRotation),
            definition("Tirar o lixo", "Separar recicláveis", room: wholeHouseRoom, effort: 1, policy: .balancedAutomatically),
            definition("Lavar roupas de cama", "Trocar e lavar os lençóis", room: laundry, effort: 2, policy: .afterCompletion),
            definition("Organizar documentos", "Tarefa do escritório privado", room: privateOffice, effort: 1, policy: .calendarRotation),
            definition("Trocar a lâmpada da sala", "Tarefa avulsa de manutenção", room: livingRoom, effort: 2, kind: .sporadic, policy: .selfAssigned)
        ]
        var state = MockStore.State(
            users: users,
            houses: [house],
            houseMemberships: memberships,
            rooms: seededRooms,
            roomMemberships: commonMemberships + privateMemberships,
            definitions: [],
            occurrences: [],
            assignments: [],
            absences: []
        )
        let scheduling = TaskSchedulingService(calendar: Calendar(identifier: .gregorian))
        // Demo data follows the same planner and invariants as user-created data.
        do {
            let start = try scheduling.weekStart(.now)
            var schedule = state.schedule
            for definition in definitions { _ = try scheduling.create(definition, at: start, state: &schedule) }
            state.schedule = schedule
        } catch { preconditionFailure("Invalid demo schedule: \(error)") }
        return state

    }

    private nonisolated static func definition(_ name: String, _ details: String, room: Room, effort: Int, kind: TaskKind = .recurring, policy: TaskAssignmentPolicy) -> TaskDefinition {
        TaskDefinition(id: UUID(), roomID: room.id, name: name, details: details, effort: TaskEffort(points: effort), kind: kind, recurrence: kind == .recurring ? .recurring(frequency: .weekly, interval: 1) : .none, assignmentPolicy: policy)
    }
}
