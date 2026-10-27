import Foundation
import GrupuxoDomain

/// Prévia visual apenas: saldo, sucessores e atribuições continuam sendo calculados pelo servidor.
struct OptimisticTaskCompletions {
    private(set) var pendingIDs: Set<TaskOccurrence.ID> = []
    private(set) var revision = 0
    private var overrides: [TaskOccurrence.ID: TaskItem] = [:]

    var isCompleting: Bool { !pendingIDs.isEmpty }

    mutating func begin(_ item: TaskItem, by userID: User.ID, at date: Date = .now) {
        revision += 1
        pendingIDs.insert(item.id)
        var occurrence = item.occurrence
        occurrence.status = item.occurrence.isCompleted ? .assigned : .completed
        occurrence.completedAt = occurrence.isCompleted ? date : nil
        occurrence.completedByUserID = occurrence.isCompleted ? userID : nil
        overrides[item.id] = TaskItem(
            definition: item.definition, occurrence: occurrence, assignment: item.assignment,
            assignee: item.assignee, suggestedAssignee: item.suggestedAssignee
        )
    }

    mutating func finish(_ id: TaskOccurrence.ID, restoring item: TaskItem? = nil) {
        revision += 1
        pendingIDs.remove(id)
        if let item { overrides[id] = item }
    }

    /// Só uma resposta iniciada depois de todas as escritas substitui as prévias confirmadas.
    mutating func acceptReload() {
        if !isCompleting { overrides.removeAll() }
    }

    func applying(to item: TaskItem) -> TaskItem { overrides[item.id] ?? item }

    func applying(to overview: MyTasksOverview) -> MyTasksOverview {
        MyTasksOverview(
            cycleGroups: overview.cycleGroups.map { group in
                let updated = group.tasks.map { applying(to: $0) }
                let delta = updated.filter { $0.occurrence.isCompleted }.count
                    - group.tasks.filter { $0.occurrence.isCompleted }.count
                return CycleGroup(
                    room: group.room, periodEnd: group.periodEnd,
                    progress: CycleProgress(completed: group.progress.completed + delta, total: group.progress.total),
                    tasks: updated
                )
            },
            extraTasks: overview.extraTasks.map { RoomTask(room: $0.room, item: applying(to: $0.item)) },
            sporadicTasks: overview.sporadicTasks.map { RoomTask(room: $0.room, item: applying(to: $0.item)) }
        )
    }
}
