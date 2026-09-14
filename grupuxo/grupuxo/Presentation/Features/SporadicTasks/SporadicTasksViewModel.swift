import Combine
import Foundation

@MainActor
final class SporadicTasksViewModel: ObservableObject {
    @Published private(set) var state: SporadicTasksState = .idle
    private let getTasks: GetSporadicTasksUseCase
    private let claimTask: ClaimSporadicTaskUseCase
    private let releaseTask: ReleaseSporadicTaskUseCase
    private let userID: User.ID
    private let houseID: House.ID

    init(getTasks: GetSporadicTasksUseCase, claimTask: ClaimSporadicTaskUseCase, releaseTask: ReleaseSporadicTaskUseCase, userID: User.ID, houseID: House.ID) {
        self.getTasks = getTasks
        self.claimTask = claimTask
        self.releaseTask = releaseTask
        self.userID = userID
        self.houseID = houseID
    }

    func load() async {
        state = .loading
        do {
            let tasks = try await getTasks(houseID: houseID, userID: userID)
            state = tasks.isEmpty ? .empty : .content(tasks)
        } catch {
            state = .failure(error.localizedDescription)
        }
    }

    func claim(_ occurrenceID: TaskOccurrence.ID) async { await perform { try await claimTask(occurrenceID: occurrenceID, userID: userID) } }
    func release(_ occurrenceID: TaskOccurrence.ID) async { await perform { try await releaseTask(occurrenceID: occurrenceID, userID: userID) } }

    private func perform(_ action: () async throws -> Void) async {
        do {
            try await action()
            await load()
        } catch {
            state = .failure(error.localizedDescription)
        }
    }
}
