import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct SporadicUndoTests {
    private func item(in model: SporadicTasksViewModel, id: TaskOccurrence.ID) -> TaskItem? {
        guard case let .content(items) = model.state else { return nil }
        return items.first { $0.task.id == id }?.task
    }

    @Test func sporadicCompletionTogglesAndKeepsTheResident() async throws {
        let container = AppContainer()
        let me = MockSeed.currentUser
        let definition = TaskDefinition(
            id: UUID(), roomID: MockSeed.kitchen.id, name: "Trocar o filtro", details: "", effort: TaskEffort(points: 1),
            kind: .sporadic, recurrence: .none, assignmentPolicy: .selfAssigned, createdByUserID: me.id
        )
        _ = try await container.taskRepository.create(definition, requestedBy: me.id, at: .now)
        let occurrence = try #require(await container.store.read { state in
            state.occurrences.first { $0.taskDefinitionID == definition.id }
        })
        try await container.taskRepository.claim(occurrenceID: occurrence.id, by: me.id, at: .now)

        let model = container.makeSporadicTasksViewModel(session: AppSession(currentUser: me, currentHouse: MockSeed.house))
        await model.load()
        let claimed = try #require(item(in: model, id: occurrence.id))
        #expect(model.canComplete(claimed))

        await model.complete(occurrence.id)
        #expect(model.actionError == nil)
        let completed = try #require(item(in: model, id: occurrence.id))
        #expect(completed.occurrence.isCompleted)
        let debtAfterCompleting = await container.store.read { state in
            state.roomMemberships.first { $0.roomID == MockSeed.kitchen.id && $0.userID == me.id }?.fairnessDebt
        }

        // Concluída continua acionável pelo responsável: concluir de novo desfaz.
        #expect(model.canComplete(completed))
        await model.complete(occurrence.id)
        #expect(model.actionError == nil)
        let reopened = try #require(item(in: model, id: occurrence.id))
        #expect(!reopened.occurrence.isCompleted)
        #expect(reopened.assignment?.userID == me.id)
        #expect(await container.store.read { $0.occurrences.filter { $0.taskDefinitionID == definition.id }.count } == 1)
        let debtAfterUndo = await container.store.read { state in
            state.roomMemberships.first { $0.roomID == MockSeed.kitchen.id && $0.userID == me.id }?.fairnessDebt
        }
        #expect(debtAfterUndo != debtAfterCompleting)   // o impacto no saldo foi revertido

        // Quem não é o responsável não pode concluir nem desfazer.
        let other = try #require(MockSeed.users.first { $0.id != me.id })
        let otherModel = container.makeSporadicTasksViewModel(session: AppSession(currentUser: other, currentHouse: MockSeed.house))
        await otherModel.load()
        let seenByOther = try #require(item(in: otherModel, id: occurrence.id))
        #expect(!otherModel.canComplete(seenByOther))
    }
}
