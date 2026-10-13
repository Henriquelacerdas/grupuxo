import Foundation
import GrupuxoDomain

enum MockSeed {

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
        icon: "house.fill",
        color: .blue
    )

    nonisolated static let kitchen = Room(
        id: UUID(),
        houseID: house.id,
        name: "Cozinha",
        kind: .standard,
        category: .kitchen,
        visibility: .common,
        icon: "refrigerator.fill",
        color: .orange
    )

    nonisolated static let bathroom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Banheiro",
        kind: .standard,
        category: .bathroom,
        visibility: .common,
        icon: "toilet.fill",
        color: .green
    )

    nonisolated static let livingRoom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Sala de Estar",
        kind: .standard,
        category: .livingRoom,
        visibility: .common,
        icon: "sofa.fill",
        color: .indigo
    )

    nonisolated static let laundry = Room(
        id: UUID(),
        houseID: house.id,
        name: "Lavanderia",
        kind: .standard,
        category: .laundry,
        visibility: .common,
        icon: "washer.fill",
        color: .pink
    )

    /// Ciclo de duas semanas e dois responsáveis, para variar a tela Casa.
    nonisolated static let garage = Room(
        id: UUID(),
        houseID: house.id,
        name: "Garagem",
        kind: .standard,
        category: .outdoor,
        visibility: .common,
        periodicity: WeeklyPeriodicity(intervalWeeks: 2),
        responsibleCount: 2,
        icon: "car.fill",
        color: .brown
    )

    /// Privado com acesso para a Marina (cadeado aberto).
    nonisolated static let privateOffice = Room(
        id: UUID(),
        houseID: house.id,
        name: "Escritório privado",
        kind: .standard,
        category: .office,
        visibility: .privateRoom,
        icon: "display",
        color: .purple
    )

    /// Privado sem acesso para a Marina (cadeado fechado, pode pedir para entrar).
    nonisolated static let bedroom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Quarto 1",
        kind: .standard,
        category: .bedroom,
        visibility: .privateRoom,
        icon: "bed.double.fill",
        color: .teal
    )

    /// Privado sem acesso para a Marina, com pedido de entrada já aberto no seed.
    nonisolated static let secondBathroom = Room(
        id: UUID(),
        houseID: house.id,
        name: "Banheiro 2",
        kind: .standard,
        category: .bathroom,
        visibility: .privateRoom,
        icon: "bathtub.fill",
        color: .cyan
    )

    nonisolated static let rooms = [
        wholeHouseRoom,
        bathroom,
        kitchen,
        livingRoom,
        garage,
        laundry,
        privateOffice,
        bedroom,
        secondBathroom
    ]

    /// Moradores de cada cômodo privado.
    nonisolated static let privateMembers: [(room: Room, users: [User])] = [
        (privateOffice, [currentUser, bia]),
        (bedroom, [leo, rafa]),
        (secondBathroom, [bia, leo])
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
            .filter {
                $0.visibility == .common
            }
            .flatMap { room in
                users.map {
                    RoomMembership(
                        id: UUID(),
                        roomID: room.id,
                        userID: $0.id
                    )
                }
            }

        let privateMemberships = privateMembers.flatMap { entry in
            entry.users.map {
                RoomMembership(
                    id: UUID(),
                    roomID: entry.room.id,
                    userID: $0.id
                )
            }
        }

        let definitions = recurringDefinitions + sporadicDefinitions

        // A Marina pediu para entrar no Banheiro 2 e aguarda resposta.
        let accessRequests = [
            RoomAccessRequest(
                id: UUID(),
                roomID: secondBathroom.id,
                userID: currentUser.id,
                requestedAt: .now
            )
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
            absences: [],
            taskSwapRequests: [],
            notifications: [],
            roomAccessRequests: accessRequests
        )

        let scheduling = TaskSchedulingService(
            calendar: Calendar(identifier: .gregorian)
        )

        do {
            let start = try scheduling.weekStart(.now)

            var schedule = state.schedule

            for definition in definitions {
                _ = try scheduling.create(
                    definition,
                    at: start,
                    state: &schedule
                )
            }

            for (room, count) in seededProgress {
                try complete(
                    count,
                    linkedTasksIn: room,
                    scheduling: scheduling,
                    state: &schedule
                )
            }

            // As conclusões acima só existem para a barra de progresso: o seed começa sem saldo de justiça.
            for index in schedule.roomMemberships.indices {
                schedule.roomMemberships[index].fairnessDebt = 0
            }

            state.schedule = schedule

        } catch {
            preconditionFailure(
                "Invalid demo schedule: \(error)"
            )
        }

        return state
    }

    /// Tarefas do ciclo de cada cômodo já concluídas no seed, para a barra de progresso da tela Casa.
    private nonisolated static let seededProgress: [(room: Room, completed: Int)] = [
        (bathroom, 2),
        (kitchen, 2),
        (livingRoom, 1)
    ]

    private nonisolated static var recurringDefinitions: [TaskDefinition] {

        [
            // Banheiro: 4 tarefas no ciclo.
            definition("Higienizar o banheiro", "Vaso, pia e espelho", room: bathroom, effort: 3, policy: .calendarRotation),
            definition("Repor papel higiênico", "Conferir o armário", room: bathroom, effort: 1, policy: .balancedAutomatically),
            definition("Lavar o box", "Paredes e ralo", room: bathroom, effort: 2, policy: .balancedAutomatically),
            definition("Esvaziar o lixo do banheiro", "Trocar o saco", room: bathroom, effort: 1, policy: .balancedAutomatically),

            // Cozinha: 4 tarefas no ciclo, mais uma extra (afterCompletion).
            definition("Lavar a louça", "Limpar pia e escorredor", room: kitchen, effort: 2, policy: .balancedAutomatically),
            definition("Limpar o fogão", "Bocas e bancada ao redor", room: kitchen, effort: 2, policy: .calendarRotation),
            definition("Limpar a geladeira", "Prateleiras e gavetas", room: kitchen, effort: 3, policy: .calendarRotation),
            definition("Varrer a cozinha", "Incluindo embaixo da mesa", room: kitchen, effort: 1, policy: .balancedAutomatically),
            definition("Limpar bancada", "Passar pano e retirar migalhas", room: kitchen, effort: 1, policy: .afterCompletion),

            // Sala de Estar: 4 tarefas no ciclo.
            definition("Aspirar a sala", "Incluindo embaixo do sofá", room: livingRoom, effort: 2, policy: .calendarRotation),
            definition("Passar pano no chão", "Sala inteira", room: livingRoom, effort: 2, policy: .calendarRotation),
            definition("Tirar o pó dos móveis", "Estante, mesa e rack", room: livingRoom, effort: 1, policy: .balancedAutomatically),
            definition("Limpar a TV e o painel", "Pano seco", room: livingRoom, effort: 1, policy: .balancedAutomatically),

            // Garagem: 3 tarefas, ciclo de duas semanas.
            definition("Varrer a garagem", "Folhas e poeira", room: garage, effort: 2, policy: .balancedAutomatically),
            definition("Lavar o chão da garagem", "Mangueira e vassoura", room: garage, effort: 3, policy: .calendarRotation),
            definition("Organizar as ferramentas", "Caixa e prateleiras", room: garage, effort: 1, policy: .balancedAutomatically),

            // Demais cômodos.
            definition("Tirar o lixo", "Separar recicláveis", room: wholeHouseRoom, effort: 1, policy: .balancedAutomatically),
            definition("Lavar roupas de cama", "Trocar e lavar os lençóis", room: laundry, effort: 2, policy: .afterCompletion),
            definition("Limpar o filtro da máquina", "Retirar fiapos", room: laundry, effort: 1, policy: .calendarRotation),
            definition("Organizar documentos", "Tarefa do escritório privado", room: privateOffice, effort: 1, policy: .calendarRotation),
            definition("Arrumar a cama", "Lençol e travesseiros", room: bedroom, effort: 1, policy: .balancedAutomatically),
            definition("Higienizar o banheiro 2", "Vaso, pia e box", room: secondBathroom, effort: 2, policy: .calendarRotation)
        ]
    }

    /// Tarefas únicas em cômodos comuns, para ficarem visíveis a todos os moradores.
    private nonisolated static var sporadicDefinitions: [TaskDefinition] {

        [
            definition("Chamar encanador", "Vazamento embaixo da pia", room: kitchen, effort: 1, kind: .sporadic, policy: .selfAssigned),
            definition("Trocar resistência do chuveiro", "Comprar a peça antes", room: bathroom, effort: 2, kind: .sporadic, policy: .selfAssigned),
            definition("Consertar o portão da garagem", "Dobradiça solta", room: garage, effort: 3, kind: .sporadic, policy: .selfAssigned),
            definition("Desentupir o ralo da lavanderia", "Água não escoa", room: laundry, effort: 2, kind: .sporadic, policy: .selfAssigned)
        ]
    }

    /// Conclui as primeiras `count` tarefas do ciclo do cômodo, na ordem de criação, pelo responsável de cada uma.
    private nonisolated static func complete(
        _ count: Int,
        linkedTasksIn room: Room,
        scheduling: TaskSchedulingService,
        state: inout TaskSchedulingState
    ) throws {

        let linked = state.definitions.filter {
            $0.isLinked(to: room)
        }

        for definition in linked.prefix(count) {

            guard
                let occurrence = state.occurrences.first(where: {
                    $0.taskDefinitionID == definition.id
                }),
                let assignment = state.assignments.first(where: {
                    $0.occurrenceID == occurrence.id && $0.isActive
                })
            else {
                throw DomainError.entityNotFound
            }

            try scheduling.complete(
                occurrenceID: occurrence.id,
                by: assignment.userID,
                at: .now,
                state: &state
            )
        }
    }

    private nonisolated static func definition(
        _ name: String,
        _ details: String,
        room: Room,
        effort: Int,
        kind: TaskKind = .recurring,
        policy: TaskAssignmentPolicy
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
            recurrence: kind == .recurring
                ? .recurring(
                    frequency: .weekly,
                    interval: room.periodicity.intervalWeeks
                )
                : .none,
            assignmentPolicy: policy
        )
    }
}
