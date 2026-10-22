import Foundation

/// Uma tarefa do morador junto do cômodo a que pertence.
public struct RoomTask: Equatable, Sendable, Identifiable {
    public let room: Room
    public let item: TaskItem

    public var id: TaskOccurrence.ID { item.id }

    public init(room: Room, item: TaskItem) {
        self.room = room
        self.item = item
    }
}

/// Tarefas de um cômodo que o morador tem no ciclo atual desse cômodo.
public struct CycleGroup: Equatable, Sendable, Identifiable {
    public let room: Room
    /// Fim (exclusivo) do ciclo atual do cômodo.
    public let periodEnd: Date
    /// Progresso do cômodo inteiro no ciclo, não só das tarefas do morador.
    public let progress: CycleProgress
    public let tasks: [TaskItem]

    public var id: Room.ID { room.id }

    public init(room: Room, periodEnd: Date, progress: CycleProgress, tasks: [TaskItem]) {
        self.room = room
        self.periodEnd = periodEnd
        self.progress = progress
        self.tasks = tasks
    }
}

/// Tudo o que o morador tem a fazer, separado como a tela Minhas tarefas mostra.
public struct MyTasksOverview: Equatable, Sendable {
    /// Cômodos de que o morador é responsável neste ciclo, com as tarefas de mesma periodicidade do cômodo.
    public let cycleGroups: [CycleGroup]
    /// Tarefas recorrentes de periodicidade diferente da do cômodo (ou que rodam após a conclusão).
    public let extraTasks: [RoomTask]
    /// Tarefas únicas que o morador assumiu.
    public let sporadicTasks: [RoomTask]

    public var isEmpty: Bool {
        cycleGroups.isEmpty && extraTasks.isEmpty && sporadicTasks.isEmpty
    }

    public init(cycleGroups: [CycleGroup], extraTasks: [RoomTask], sporadicTasks: [RoomTask]) {
        self.cycleGroups = cycleGroups
        self.extraTasks = extraTasks
        self.sporadicTasks = sporadicTasks
    }
}

public struct GetMyTasksOverviewUseCase: Sendable {
    public let roomRepository: any RoomRepository
    public let taskRepository: any TaskRepository

    public init(
        roomRepository: any RoomRepository,
        taskRepository: any TaskRepository
    ) {
        self.roomRepository = roomRepository
        self.taskRepository = taskRepository
    }

    /// Tarefas concluídas só continuam visíveis dentro do ciclo do cômodo (seu ciclo) ou da semana
    /// corrente (extras e únicas); as abertas aparecem sempre. O histórico antigo fica de fora.
    public func callAsFunction(
        houseID: House.ID,
        userID: User.ID,
        at date: Date,
        calendar: Calendar
    ) async throws -> MyTasksOverview {

        let items = try await taskRepository.tasks(for: userID, in: houseID)
        let roomsByID = Dictionary(
            try await roomRepository.rooms(in: houseID, requesting: userID).map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        let week = calendar.dateInterval(of: .weekOfYear, for: date)

        func isRecent(_ item: TaskItem) -> Bool {
            guard let completedAt = item.occurrence.completedAt, let week else { return false }
            return week.contains(completedAt)
        }

        var linkedByRoom: [Room.ID: [TaskItem]] = [:]
        var extras: [RoomTask] = []
        var sporadics: [RoomTask] = []

        for item in items {
            guard let room = roomsByID[item.definition.roomID] else { continue }

            if item.definition.kind == .sporadic {
                if !item.occurrence.isCompleted || isRecent(item) {
                    sporadics.append(RoomTask(room: room, item: item))
                }
            } else if item.definition.isLinked(to: room) {
                linkedByRoom[room.id, default: []].append(item)
            } else if !item.occurrence.isCompleted || isRecent(item) {
                extras.append(RoomTask(room: room, item: item))
            }
        }

        var groups: [CycleGroup] = []

        for (roomID, linked) in linkedByRoom {
            guard let room = roomsByID[roomID] else { continue }

            let participation = try await roomRepository.participation(in: roomID, requesting: userID, at: date)

            let cycleTasks = linked.filter {
                let availableAt = $0.occurrence.availableAt
                return (availableAt >= participation.periodStart && availableAt < participation.periodEnd)
                    || (!$0.occurrence.isCompleted && availableAt < participation.periodStart)
            }

            guard !cycleTasks.isEmpty else { continue }

            groups.append(CycleGroup(
                room: room,
                periodEnd: participation.periodEnd,
                progress: try await taskRepository.cycleProgress(of: participation, requesting: userID),
                tasks: openFirst(cycleTasks, item: { $0 })
            ))
        }

        groups.sort {
            if $0.periodEnd != $1.periodEnd { return $0.periodEnd < $1.periodEnd }
            if $0.room.name != $1.room.name { return $0.room.name < $1.room.name }
            return $0.room.id.uuidString.lowercased() < $1.room.id.uuidString.lowercased()
        }

        return MyTasksOverview(
            cycleGroups: groups,
            extraTasks: openFirst(extras, item: \.item),
            sporadicTasks: openFirst(sporadics, item: \.item)
        )
    }
}

/// Abertas primeiro, depois as concluídas; cada grupo por prazo, nome e ID (texto em minúsculo).
private func openFirst<Element>(
    _ elements: [Element],
    item: (Element) -> TaskItem
) -> [Element] {

    let sorted = elements.sorted { lhs, rhs in
        let left = item(lhs)
        let right = item(rhs)
        let leftDue = left.occurrence.dueAt ?? .distantFuture
        let rightDue = right.occurrence.dueAt ?? .distantFuture
        if leftDue != rightDue { return leftDue < rightDue }
        if left.definition.name != right.definition.name { return left.definition.name < right.definition.name }
        return left.id.uuidString.lowercased() < right.id.uuidString.lowercased()
    }

    return sorted.filter { !item($0).occurrence.isCompleted }
        + sorted.filter { item($0).occurrence.isCompleted }
}
