import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct RoomEditorPeriodicityTests {

    private func model(editing room: Room, in container: AppContainer) -> RoomEditorViewModel {
        container.makeRoomEditorViewModel(
            editing: room, session: AppSession(currentUser: MockSeed.currentUser, currentHouse: MockSeed.house)
        )
    }

    @Test func changingThePeriodicityOfARoomWithLinkedTasksAsksForConfirmation() async throws {
        let container = AppContainer()
        let room = MockSeed.kitchen
        let tasks = try await container.taskRepository.tasks(in: room.id, requesting: MockSeed.currentUser.id)
        try #require(tasks.contains { $0.definition.isLinked(to: room) }, "a cozinha da demonstração tem tarefas do ciclo")

        let editor = model(editing: room, in: container)
        #expect(await editor.needsPeriodicityConfirmation() == false, "sem mudar a periodicidade, salva direto")

        editor.updateDraft { $0.periodicity = WeeklyPeriodicity(executionsPerPeriod: 1, intervalWeeks: 2) }
        #expect(await editor.needsPeriodicityConfirmation() == true)
    }

    @Test func aRoomWithoutLinkedTasksChangesPeriodicityWithoutAsking() async throws {
        let container = AppContainer()
        var quiet: Room?
        for room in MockSeed.rooms {
            let tasks = try await container.taskRepository.tasks(in: room.id, requesting: MockSeed.currentUser.id)
            if !tasks.contains(where: { $0.definition.isLinked(to: room) }) { quiet = room; break }
        }
        let room = try #require(quiet, "a demonstração tem um cômodo sem tarefas do ciclo")
        let editor = model(editing: room, in: container)
        editor.updateDraft { $0.periodicity = WeeklyPeriodicity(executionsPerPeriod: 1, intervalWeeks: 4) }
        #expect(await editor.needsPeriodicityConfirmation() == false)
    }
}
