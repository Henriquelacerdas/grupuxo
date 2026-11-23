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

    private func makeTask(
        _ container: AppContainer, createdBy creator: User, name: String
    ) async throws -> TaskOccurrence {
        let definition = TaskDefinition(
            id: UUID(), roomID: MockSeed.kitchen.id, name: name, details: "", effort: TaskEffort(points: 1),
            kind: .sporadic, recurrence: .none, assignmentPolicy: .selfAssigned, createdByUserID: creator.id
        )
        _ = try await container.taskRepository.create(definition, requestedBy: creator.id, at: .now)
        return try #require(await container.store.read { state in
            state.occurrences.first { $0.taskDefinitionID == definition.id }
        })
    }

    @Test func freeTaskCreatedByAnotherResidentCanBeAdded() async throws {
        let container = AppContainer()
        let me = MockSeed.currentUser
        let other = try #require(MockSeed.users.first { $0.id != me.id })
        let occurrence = try await makeTask(container, createdBy: other, name: "Trocar a resistência")

        let model = container.makeSporadicTasksViewModel(session: AppSession(currentUser: me, currentHouse: MockSeed.house))
        await model.load()
        let free = try #require(item(in: model, id: occurrence.id))
        #expect(model.canClaim(free), "criada por outro e ainda livre: dá para adicionar")
        #expect(!model.canRelease(free))
        #expect(model.takenByAnotherName(free) == nil)

        await model.claim(occurrence.id)
        #expect(model.isPendingClaim(free))
        #expect(model.canRelease(free), "marcada: aparece \"Desfazer\" antes de confirmar")
        #expect(model.hasPendingChanges)
        #expect(await model.confirmPendingAssignmentChanges())
        let mine = try #require(item(in: model, id: occurrence.id))
        #expect(mine.assignment?.userID == me.id)
    }

    @Test func taskTakenByAnotherResidentShowsWhoAndCannotBeAdded() async throws {
        let container = AppContainer()
        let me = MockSeed.currentUser
        let other = try #require(MockSeed.users.first { $0.id != me.id })
        let occurrence = try await makeTask(container, createdBy: me, name: "Mover o sofá")
        try await container.taskRepository.claim(occurrenceID: occurrence.id, by: other.id, at: .now)

        let model = container.makeSporadicTasksViewModel(session: AppSession(currentUser: me, currentHouse: MockSeed.house))
        await model.load()
        let taken = try #require(item(in: model, id: occurrence.id))
        #expect(!model.canClaim(taken))
        #expect(!model.canRelease(taken))
        #expect(model.takenByAnotherName(taken) != nil)
        let label = try #require(model.assigneeName(taken))
        #expect(label != "Você" && !label.isEmpty, "mostra o nome de quem está com a tarefa")

        let mine = container.makeSporadicTasksViewModel(session: AppSession(currentUser: other, currentHouse: MockSeed.house))
        await mine.load()
        let seenByOwner = try #require(item(in: mine, id: occurrence.id))
        #expect(mine.assigneeName(seenByOwner) == "Você")
    }

    @Test func onlyWhoHoldsASporadicTaskCanEditOrDeleteIt() async throws {
        let container = AppContainer()
        let me = MockSeed.currentUser
        let other = try #require(MockSeed.users.first { $0.id != me.id })
        let occurrence = try await makeTask(container, createdBy: me, name: "Trocar lâmpada")
        let id = occurrence.taskDefinitionID

        // Antes de alguém pegar, nem quem criou edita ou apaga.
        await #expect(throws: DomainError.taskUnavailable) {
            _ = try await container.taskRepository.updateTaskDetails(id: id, name: "x", details: "", requestedBy: me.id)
        }
        await #expect(throws: DomainError.taskUnavailable) {
            try await container.taskRepository.deleteSporadicTask(id: id, requestedBy: me.id)
        }

        // Outro morador pega: só ele passa a poder; quem criou continua sem poder.
        try await container.taskRepository.claim(occurrenceID: occurrence.id, by: other.id, at: .now)
        await #expect(throws: DomainError.taskUnavailable) {
            try await container.taskRepository.deleteSporadicTask(id: id, requestedBy: me.id)
        }
        let edited = try await container.taskRepository.updateTaskDetails(id: id, name: "Trocar a lâmpada", details: "", requestedBy: other.id)
        #expect(edited.name == "Trocar a lâmpada")
        try await container.taskRepository.deleteSporadicTask(id: id, requestedBy: other.id)
        #expect(await container.store.read { state in state.definitions.contains { $0.id == id } } == false)
    }
}
