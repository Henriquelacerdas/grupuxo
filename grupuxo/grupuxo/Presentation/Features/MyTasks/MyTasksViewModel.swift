import Combine
import Foundation

@MainActor
final class MyTasksViewModel: ObservableObject {
    @Published private(set) var state: MyTasksState = .idle
    private let getMyTasks: GetMyTasksUseCase
    private let completeTask: CompleteTaskUseCase
    private let userID: User.ID
    private let houseID: House.ID

    init(getMyTasks: GetMyTasksUseCase, completeTask: CompleteTaskUseCase, userID: User.ID, houseID: House.ID) {
        self.getMyTasks = getMyTasks
        self.completeTask = completeTask
        self.userID = userID
        self.houseID = houseID
    }

    func load() async {
        state = .loading
        do {
            let tasks = try await getMyTasks(userID: userID, houseID: houseID)
            state = tasks.isEmpty ? .empty : .content(tasks)
        } catch {
            state = .failure(error.localizedDescription)
        }
    }

    func complete(_ occurrenceID: TaskOccurrence.ID) async {
        do {
            try await completeTask(occurrenceID: occurrenceID, userID: userID)
            await load()
        } catch {
            state = .failure(error.localizedDescription)
        }
    }
}
