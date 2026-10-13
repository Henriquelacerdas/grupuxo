import Foundation

/// Tarefas do ciclo atual do cômodo: quantas já foram concluídas.
public struct CycleProgress: Equatable, Sendable {
    public let completed: Int
    public let total: Int

    public init(completed: Int, total: Int) {
        self.completed = completed
        self.total = total
    }

    /// Entre 0 e 1; sem tarefas no ciclo, 0.
    public var fraction: Double {
        total > 0 ? Double(completed) / Double(total) : 0
    }
}

/// Resumo de um cômodo para a tela Casa. Para quem não participa do cômodo, só `room` e
/// `accessRequestPending` carregam informação: responsáveis e progresso não saem do cômodo.
public struct RoomOverview: Equatable, Sendable, Identifiable {
    public let room: Room
    public let isMember: Bool
    /// Responsáveis pelas tarefas de mesma periodicidade do cômodo no ciclo atual.
    public let cycleResponsibleNames: [String]
    /// Mesma ordem e tamanho de `cycleResponsibleNames`.
    public let cycleResponsibleUserIDs: [User.ID]
    /// Início do ciclo atual.
    public let periodStart: Date
    /// Fim (exclusivo) do ciclo atual.
    public let periodEnd: Date
    /// `nil` para quem não participa do cômodo.
    public let cycleProgress: CycleProgress?
    /// Pedido de entrada aberto do morador; só faz sentido para quem não participa.
    public let accessRequestPending: Bool

    public var id: Room.ID { room.id }

    public init(
        room: Room,
        isMember: Bool,
        cycleResponsibleNames: [String],
        cycleResponsibleUserIDs: [User.ID],
        periodStart: Date,
        periodEnd: Date,
        cycleProgress: CycleProgress?,
        accessRequestPending: Bool
    ) {
        self.room = room
        self.isMember = isMember
        self.cycleResponsibleNames = cycleResponsibleNames
        self.cycleResponsibleUserIDs = cycleResponsibleUserIDs
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.cycleProgress = cycleProgress
        self.accessRequestPending = accessRequestPending
    }
}

public struct HouseOverview: Equatable, Sendable {
    /// Tarefas únicas (esporádicas) ainda abertas, na ordem de prazo.
    public let sporadicTasks: [TaskItem]
    public let rooms: [RoomOverview]

    public init(sporadicTasks: [TaskItem], rooms: [RoomOverview]) {
        self.sporadicTasks = sporadicTasks
        self.rooms = rooms
    }
}

public struct GetHouseOverviewUseCase: Sendable {
    public let roomRepository: any RoomRepository
    public let taskRepository: any TaskRepository
    public let accessRequestRepository: any RoomAccessRequestRepository

    public init(
        roomRepository: any RoomRepository,
        taskRepository: any TaskRepository,
        accessRequestRepository: any RoomAccessRequestRepository
    ) {
        self.roomRepository = roomRepository
        self.taskRepository = taskRepository
        self.accessRequestRepository = accessRequestRepository
    }

    public func callAsFunction(houseID: House.ID, userID: User.ID, at date: Date) async throws -> HouseOverview {
        let rooms = try await roomRepository.rooms(in: houseID, requesting: userID)
        let pendingRequests = try await accessRequestRepository.pendingRoomIDs(in: houseID, requesting: userID)

        var overviews: [RoomOverview] = []
        for room in rooms {
            let participation = try await roomRepository.participation(in: room.id, requesting: userID, at: date)
            let progress = participation.isMember
                ? try await taskRepository.cycleProgress(of: participation, requesting: userID)
                : nil
            overviews.append(RoomOverview(
                room: participation.room,
                isMember: participation.isMember,
                cycleResponsibleNames: participation.responsibleNames,
                cycleResponsibleUserIDs: participation.responsibleUserIDs,
                periodStart: participation.periodStart,
                periodEnd: participation.periodEnd,
                cycleProgress: progress,
                accessRequestPending: !participation.isMember && pendingRequests.contains(room.id)
            ))
        }

        let sporadic = try await taskRepository.sporadicTasks(in: houseID, requesting: userID)
            .filter { !$0.occurrence.isCompleted }
            .sortedByDeadline()

        return HouseOverview(sporadicTasks: sporadic, rooms: overviews)
    }
}

extension TaskRepository {

    /// Conta as ocorrências do ciclo atual das tarefas que seguem a escala do cômodo.
    func cycleProgress(of participation: RoomParticipation, requesting userID: User.ID) async throws -> CycleProgress {
        let room = participation.room
        let cycleTasks = try await tasks(in: room.id, requesting: userID).filter {
            $0.definition.isLinked(to: room)
                && $0.occurrence.availableAt >= participation.periodStart
                && $0.occurrence.availableAt < participation.periodEnd
        }
        return CycleProgress(
            completed: cycleTasks.filter { $0.occurrence.isCompleted }.count,
            total: cycleTasks.count
        )
    }
}
