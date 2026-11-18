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
        // Cada consulta é uma chamada à `api`: as independentes saem juntas, e as de cada cômodo em paralelo.
        async let pendingRequests = accessRequestRepository.pendingRoomIDs(in: houseID, requesting: userID)
        async let sporadicItems = taskRepository.sporadicTasks(in: houseID, requesting: userID)
        let rooms = try await roomRepository.rooms(in: houseID, requesting: userID)

        let roomRepository = roomRepository
        let taskRepository = taskRepository
        let summaries = try await rooms.concurrentMap(limit: maxConcurrentRoomQueries) { room in
            let participation = try await roomRepository.participation(in: room.id, requesting: userID, at: date)
            let summary = participation.isMember
                ? try await taskRepository.cycleSummary(of: participation, requesting: userID)
                : nil
            return (participation, summary)
        }

        let pending = try await pendingRequests
        let overviews = summaries.map { participation, summary in
            // Quem está com as tarefas do ciclo de fato (trocas e replanejamentos incluídos), como no cômodo;
            // sem tarefas atribuídas no ciclo, vale a fila calculada.
            let assignees = summary?.assignees ?? []
            return RoomOverview(
                room: participation.room,
                isMember: participation.isMember,
                cycleResponsibleNames: assignees.isEmpty ? participation.responsibleNames : assignees.map(\.name),
                cycleResponsibleUserIDs: assignees.isEmpty ? participation.responsibleUserIDs : assignees.map(\.id),
                periodStart: participation.periodStart,
                periodEnd: participation.periodEnd,
                cycleProgress: summary?.progress,
                accessRequestPending: !participation.isMember && pending.contains(participation.room.id)
            )
        }

        let sporadic = try await sporadicItems
            .filter { !$0.occurrence.isCompleted }
            .sortedByDeadline()

        return HouseOverview(sporadicTasks: sporadic, rooms: overviews)
    }
}

/// Andamento e responsáveis do ciclo atual das tarefas que seguem a escala do cômodo.
struct CycleSummary: Sendable {
    let progress: CycleProgress
    /// Moradores com alguma tarefa do ciclo, sem repetir, em ordem estável pelo ID.
    let assignees: [User]
}

extension TaskRepository {

    /// Conta as ocorrências do ciclo atual das tarefas que seguem a escala do cômodo.
    func cycleProgress(of participation: RoomParticipation, requesting userID: User.ID) async throws -> CycleProgress {
        try await cycleSummary(of: participation, requesting: userID).progress
    }

    func cycleSummary(of participation: RoomParticipation, requesting userID: User.ID) async throws -> CycleSummary {
        let room = participation.room
        let cycleTasks = try await tasks(in: room.id, requesting: userID).filter {
            $0.definition.isLinked(to: room)
                && $0.occurrence.availableAt >= participation.periodStart
                && $0.occurrence.availableAt < participation.periodEnd
        }
        let assignees = Dictionary(grouping: cycleTasks.filter { $0.definition.kind == .recurring }.compactMap(\.assignee), by: \.id)
            .compactMap { $0.value.first }
            .sorted { $0.id.uuidString.lowercased() < $1.id.uuidString.lowercased() }
        return CycleSummary(
            progress: CycleProgress(
                completed: cycleTasks.filter { $0.occurrence.isCompleted }.count,
                total: cycleTasks.count
            ),
            assignees: assignees
        )
    }
}
