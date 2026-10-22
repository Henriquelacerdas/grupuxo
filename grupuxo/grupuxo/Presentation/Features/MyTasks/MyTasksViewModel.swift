import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class MyTasksViewModel: ObservableObject {

    @Published var actionError: String?
    @Published private(set) var isCompleting = false
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

    init(
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

    func load(showLoading: Bool = true) async {

        // Recarregar não esvazia a tela: o conteúdo atual fica até o novo chegar.
        if showLoading {
            if case .content = state {} else {
                state = .loading
            }
        }

        do {
            let date = now()

            let overview = try await getMyTasksOverview(
                houseID: houseID,
                userID: userID,
                at: date,
                calendar: calendar
            )

            state = overview.isEmpty
                ? .empty
                : .content(content(from: overview, at: date))

        } catch {
            state = .failure(
                error.localizedDescription
            )
        }
    }

    func canComplete(
        _ item: TaskItem
    ) -> Bool {

        !isCompleting
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= now()
    }

    func canRequestSwap(
        _ item: TaskItem
    ) -> Bool {

        guard let assignment = item.assignment else {
            return false
        }

        return assignment.isActive
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
    func end(
        taskID: TaskDefinition.ID
    ) async {

        do {
            try await endTask(
                taskID: taskID,
                requestedBy: userID,
                at: now()
            )

            await load(showLoading: false)

        } catch {
            actionError = error.localizedDescription
        }
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isCompleting else {
            return
        }

        guard case let .content(content) = state,
              let item = content.item(occurrenceID),
              canComplete(item) else { return }

        isCompleting = true

        defer {
            isCompleting = false
        }

        do {
            try await completeTask(
                occurrenceID: occurrenceID,
                userID: userID,
                isCompleted: !item.occurrence.isCompleted
            )

            await load(showLoading: false)

        } catch {
            actionError = error.localizedDescription
        }
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
                        MyTasksContent.Row(item: $0, roomName: nil, dueDay: nil)
                    }
                )
            },
            extras: overview.extraTasks.map { row($0, at: date) },
            sporadics: overview.sporadicTasks.map {
                MyTasksContent.Row(item: $0.item, roomName: $0.room.name, dueDay: nil)
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
            }
        )
    }
}
