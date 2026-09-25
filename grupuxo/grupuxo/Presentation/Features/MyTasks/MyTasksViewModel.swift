import Combine
import Foundation

@MainActor
final class MyTasksViewModel: ObservableObject {

    @Published var actionError: String?
    @Published private(set) var isCompleting = false
    @Published private(set) var state: MyTasksState = .idle

    private let getMyTasks: GetMyTasksUseCase
    private let completeTask: CompleteTaskUseCase

    private let userID: User.ID
    private let houseID: House.ID

    init(
        getMyTasks: GetMyTasksUseCase,
        completeTask: CompleteTaskUseCase,
        userID: User.ID,
        houseID: House.ID
    ) {
        self.getMyTasks = getMyTasks
        self.completeTask = completeTask
        self.userID = userID
        self.houseID = houseID
    }

    func load() async {
        state = .loading

        do {
            let tasks = try await getMyTasks(
                userID: userID,
                houseID: houseID
            )

            state = tasks.isEmpty
                ? .empty
                : .content(tasks)

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
            && !item.occurrence.isCompleted
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= .now
    }

    func canRequestSwap(
        _ item: TaskItem
    ) -> Bool {

        guard let assignment = item.assignment else {
            return false
        }

        return assignment.isActive
            && assignment.userID == userID
            && !item.occurrence.isCompleted
            && item.occurrence.availableAt <= .now
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isCompleting else {
            return
        }

        isCompleting = true

        defer {
            isCompleting = false
        }

        do {
            try await completeTask(
                occurrenceID: occurrenceID,
                userID: userID
            )

            await load()

        } catch {
            actionError = error.localizedDescription
        }
    }
}
