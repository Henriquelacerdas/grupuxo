import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class MyTasksViewModel: ObservableObject {

    @Published var actionError: String?
    @Published private var completions = OptimisticTaskCompletions()
    var isCompleting: Bool { completions.isCompleting }
    private var overview: MyTasksOverview?
    private var loadID: UUID?
    @Published private(set) var state: MyTasksState = .idle

    let user: User
    let houseName: String

    private let getMyTasksOverview: GetMyTasksOverviewUseCase
    private let completeTask: CompleteTaskUseCase
    private let endTask: EndTaskUseCase

    private let houseID: House.ID

    private let now: () -> Date
    private let calendar: Calendar
    private let text: MyTasksText

    private var userID: User.ID { user.id }

    private let refreshData: @Sendable () async -> Void

    init(
        refreshData: @escaping @Sendable () async -> Void = {},
        getMyTasksOverview: GetMyTasksOverviewUseCase,
        completeTask: CompleteTaskUseCase,
        endTask: EndTaskUseCase,
        user: User,
        houseName: String,
        houseID: House.ID,
        now: @escaping () -> Date = { .now },
        calendar: Calendar = .current,
        locale: Locale = HouseOverviewText.appLocale
    ) {
        self.refreshData = refreshData
        self.getMyTasksOverview = getMyTasksOverview
        self.completeTask = completeTask
        self.endTask = endTask
        self.user = user
        self.houseName = houseName
        self.houseID = houseID
        self.now = now
        self.calendar = calendar
        self.text = MyTasksText(calendar: calendar, locale: locale)
    }

    func load(showLoading: Bool = true, forceRefresh: Bool = false) async {
        if forceRefresh { await refreshData() }

        // Recarregar não esvazia a tela: o conteúdo atual fica até o novo chegar.
        if showLoading {
            if case .content = state {} else {
                state = .loading
            }
        }

        let id = UUID()
        loadID = id
        let revision = completions.revision
        do {
            let date = now()

            let overview = try await getMyTasksOverview(
                houseID: houseID,
                userID: userID,
                at: date,
                calendar: calendar
            )

            try Task.checkCancellation()
            guard loadID == id, completions.revision == revision else { return }
            self.overview = overview
            completions.acceptReload()
            presentOverview(at: date)

        } catch is CancellationError {
            // A tela saiu antes da resposta: fica o que já estava.
        } catch {
            guard loadID == id, completions.revision == revision else { return }
            // Recarga em segundo plano que falha não troca a lista pela tela de erro.
            if !showLoading, state.hasLoaded { return }
            state = .failure(
                error.localizedDescription
            )
        }
    }

    func canComplete(
        _ item: TaskItem
    ) -> Bool {

        !completions.pendingIDs.contains(item.id)
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= now()
    }

    func canRequestSwap(
        _ item: TaskItem
    ) -> Bool {

        guard let assignment = item.assignment else {
            return false
        }

        return !completions.pendingIDs.contains(item.id)
            && !item.occurrence.isCompleted
            && assignment.isActive
            && assignment.userID == userID
            && item.occurrence.availableAt <= now()
    }

    /// Só tarefas recorrentes ainda ativas podem ser encerradas; avulsas não têm exclusão na `api`.
    func canEnd(
        _ item: TaskItem
    ) -> Bool {

        item.definition.kind == .recurring
            && item.definition.endedAt == nil
    }

    /// Encerra a tarefa: o histórico fica e a ocorrência da vez continua até ser concluída.
    @discardableResult
    func end(
        taskID: TaskDefinition.ID
    ) async -> Bool {

        do {
            try await endTask(
                taskID: taskID,
                requestedBy: userID,
                at: now()
            )

            await load(showLoading: false)
            return true

        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard case let .content(content) = state,
              let item = content.item(occurrenceID),
              canComplete(item) else { return }

        completions.begin(item, by: userID, at: now())
        presentOverview(at: now())
        do {
            try await completeTask(
                occurrenceID: occurrenceID, userID: userID,
                isCompleted: !item.occurrence.isCompleted
            )
            completions.finish(occurrenceID)
        } catch {
            completions.finish(occurrenceID, restoring: item)
            presentOverview(at: now())
            actionError = error.localizedDescription
        }
        // Outras linhas continuam acionáveis; só a última escrita dispara a reconciliação.
        if !completions.isCompleting { await load(showLoading: false) }
    }

    private func presentOverview(at date: Date) {
        guard let overview else { return }
        let displayed = completions.applying(to: overview)
        state = displayed.isEmpty ? .empty : .content(content(from: displayed, at: date))
    }

    // MARK: - Apresentação

    private func content(
        from overview: MyTasksOverview,
        at date: Date
    ) -> MyTasksContent {

        MyTasksContent(
            cycles: overview.cycleGroups.map { group in

                MyTasksContent.Cycle(
                    id: group.room.id,
                    roomName: group.room.name,
                    color: group.room.color,
                    status: text.cycleStatus(
                        periodEnd: group.periodEnd,
                        progress: group.progress,
                        now: date
                    ),
                    spokenStatus: text.cycleStatusSpoken(
                        periodEnd: group.periodEnd,
                        progress: group.progress,
                        now: date
                    ),
                    rows: group.tasks.map {
                        MyTasksContent.Row(
                            item: $0,
                            roomName: nil,
                            dueDay: nil,
                            color: group.room.color
                        )
                    }
                )
            },
            extras: overview.extraTasks.map { row($0, at: date) },
            sporadics: overview.sporadicTasks.map {
                MyTasksContent.Row(
                    item: $0.item,
                    roomName: $0.room.name,
                    dueDay: nil,
                    color: $0.room.color
                )
            }
        )
    }

    private func row(
        _ task: RoomTask,
        at date: Date
    ) -> MyTasksContent.Row {

        MyTasksContent.Row(
            item: task.item,
            roomName: task.room.name,
            dueDay: task.item.occurrence.dueAt.map {
                text.dueDay($0, now: date)
            },
            color: task.room.color
        )
    }
}
