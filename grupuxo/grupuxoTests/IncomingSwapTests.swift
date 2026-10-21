import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct IncomingSwapTests {
    private struct Setup {
        let container: AppContainer
        let request: TaskSwapRequest
        let offered: TaskItem
        let requested: TaskItem
        let receiver: User
    }

    /// O morador atual pede uma troca; quem recebe é o dono da primeira candidata.
    private func makeRequest() async throws -> Setup {
        let container = AppContainer()
        let me = MockSeed.currentUser
        let myTasks = try await GetMyTasksUseCase(repository: container.taskRepository)(userID: me.id, houseID: MockSeed.house.id)
        let swaps = container.taskSwapRepository
        var pair: (TaskItem, TaskItem)?
        for task in myTasks where !task.occurrence.isCompleted {
            let candidates = try? await swaps.swapCandidates(for: me.id, offering: task.id, in: MockSeed.house.id, at: .now)
            if let candidate = candidates?.first { pair = (task, candidate); break }
        }
        let (offered, requested) = try #require(pair)
        let request = try await swaps.createRequest(
            requesterID: me.id, offeredOccurrenceID: offered.id, requestedOccurrenceID: requested.id, at: .now
        )
        let receiver = try #require(MockSeed.users.first { $0.id == request.receiverID })
        return Setup(container: container, request: request, offered: offered, requested: requested, receiver: receiver)
    }

    private func pendingSwaps(_ model: NotificationsViewModel) -> [IncomingSwapRequest] {
        guard case let .content(_, swaps) = model.state else { return [] }
        return swaps
    }

    private func assignee(_ occurrenceID: TaskOccurrence.ID, in container: AppContainer) async -> User.ID? {
        await container.store.read { state in
            state.assignments.first { $0.occurrenceID == occurrenceID && $0.isActive }?.userID
        }
    }

    @Test func receiverSeesThePendingSwapWithNamesAndAccepts() async throws {
        let setup = try await makeRequest()
        let model = setup.container.makeNotificationsViewModel(
            session: AppSession(currentUser: setup.receiver, currentHouse: MockSeed.house)
        )
        await model.load()

        let swap = try #require(pendingSwaps(model).first)
        #expect(swap.id == setup.request.id)
        #expect(swap.requesterName == MockSeed.currentUser.name)
        #expect(swap.offeredTaskName == setup.offered.definition.name)
        #expect(swap.requestedTaskName == setup.requested.definition.name)

        await model.accept(swap)
        #expect(model.actionError == nil)
        #expect(pendingSwaps(model).isEmpty)
        #expect(await assignee(setup.offered.id, in: setup.container) == setup.receiver.id)
        #expect(await assignee(setup.requested.id, in: setup.container) == MockSeed.currentUser.id)
    }

    @Test func receiverRejectsAndAssignmentsStay() async throws {
        let setup = try await makeRequest()
        let model = setup.container.makeNotificationsViewModel(
            session: AppSession(currentUser: setup.receiver, currentHouse: MockSeed.house)
        )
        await model.load()
        let swap = try #require(pendingSwaps(model).first)

        await model.reject(swap)
        #expect(model.actionError == nil)
        #expect(pendingSwaps(model).isEmpty)
        #expect(await assignee(setup.offered.id, in: setup.container) == MockSeed.currentUser.id)
        let status = await setup.container.store.read { $0.taskSwapRequests.first { $0.id == swap.id }?.status }
        #expect(status == .rejected)
    }

    @Test func requesterDoesNotSeeTheirOwnRequestAsIncoming() async throws {
        let setup = try await makeRequest()
        let model = setup.container.makeNotificationsViewModel(
            session: AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house)
        )
        await model.load()
        #expect(pendingSwaps(model).isEmpty)
    }
}
