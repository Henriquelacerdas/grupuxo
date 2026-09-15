// GUIA — create hoje salva a definição e uma ocorrência imediata sem responsável.
// TODO: suportar geração periódica por janela de calendário em fluxo próprio,
// evitar duplicar a mesma definição/período e preservar ocorrências anteriores.
// Aplicar decisões da distribuição no mesmo store.update: encerrar atribuição
// anterior, criar a nova e atualizar status, mantendo uma única atribuição ativa.
// Validar todo o lote antes de mutar o estado. Para avulsas, manter criação sem
// responsável e usar claim/release. Reforçar autorização nas mutações ao evoluir
// o contrato; os mocks devem exercitar as mesmas regras esperadas do backend.

import Foundation

struct MockTaskRepository: TaskRepository {
    let store: MockStore
    private let eligibilityPolicy = TaskEligibilityPolicy()

    func tasks(for userID: User.ID, in houseID: House.ID) async throws -> [TaskItem] {
        await store.read { state in
            let roomsByID = Dictionary(uniqueKeysWithValues: state.rooms.map { ($0.id, $0) })
            return items(from: state).filter { item in
                guard let room = roomsByID[item.definition.roomID] else { return false }
                return room.houseID == houseID
                    && eligibilityPolicy.canView(
                        item.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
                    && (item.assignment?.userID == userID || item.definition.ownerUserID == userID)
            }
        }
    }

    func tasks(in roomID: Room.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        await store.read { state in
            guard let room = state.rooms.first(where: { $0.id == roomID }) else { return [] }
            return items(from: state).filter {
                $0.definition.roomID == roomID
                    && $0.definition.kind != .sporadic
                    && eligibilityPolicy.canView(
                        $0.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
            }
        }
    }

    func sporadicTasks(in houseID: House.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        await store.read { state in
            let roomsByID = Dictionary(uniqueKeysWithValues: state.rooms.map { ($0.id, $0) })
            return items(from: state).filter {
                guard let room = roomsByID[$0.definition.roomID] else { return false }
                return room.houseID == houseID
                    && $0.definition.kind == .sporadic
                    && eligibilityPolicy.canView(
                        $0.definition,
                        room: room,
                        userID: userID,
                        roomMemberships: state.roomMemberships
                    )
            }
        }
    }

    func create(_ definition: TaskDefinition) async throws -> TaskDefinition {
        try await store.update { state in
            guard state.rooms.contains(where: { $0.id == definition.roomID }) else {
                throw DomainError.entityNotFound
            }
            if !state.definitions.contains(where: { $0.id == definition.id }) {
                state.definitions.append(definition)
                state.occurrences.append(
                    TaskOccurrence(
                        id: UUID(),
                        taskDefinitionID: definition.id,
                        availableAt: .now,
                        dueAt: nil,
                        status: .available,
                        completedAt: nil,
                        completedByUserID: nil,
                        effortSnapshot: definition.effort
                    )
                )
            }
            return definition
        }
    }

    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await store.update { state in
            guard let index = state.occurrences.firstIndex(where: { $0.id == occurrenceID }) else {
                throw DomainError.entityNotFound
            }
            guard !state.occurrences[index].isCompleted else { return }
            state.occurrences[index].status = .completed
            state.occurrences[index].completedAt = date
            state.occurrences[index].completedByUserID = userID
            for assignmentIndex in state.assignments.indices
            where state.assignments[assignmentIndex].occurrenceID == occurrenceID
                && state.assignments[assignmentIndex].endedAt == nil {
                state.assignments[assignmentIndex].endedAt = date
            }
        }
    }

    func claim(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await store.update { state in
            guard let occurrence = state.occurrences.first(where: { $0.id == occurrenceID }),
                  let definition = state.definitions.first(where: { $0.id == occurrence.taskDefinitionID }),
                  let room = state.rooms.first(where: { $0.id == definition.roomID }) else {
                throw DomainError.entityNotFound
            }
            let currentAssignment = state.assignments.first {
                $0.occurrenceID == occurrenceID && $0.endedAt == nil
            }
            let item = TaskItem(definition: definition, occurrence: occurrence, assignment: currentAssignment)
            guard eligibilityPolicy.canClaim(
                item,
                room: room,
                userID: userID,
                roomMemberships: state.roomMemberships
            ) || currentAssignment?.userID == userID else {
                throw DomainError.taskUnavailable
            }
            if let assignment = currentAssignment {
                guard assignment.userID == userID else { throw DomainError.taskUnavailable }
                return
            }
            state.assignments.append(
                TaskAssignment(id: UUID(), occurrenceID: occurrenceID, userID: userID, assignedAt: date, endedAt: nil)
            )
            if let occurrenceIndex = state.occurrences.firstIndex(where: { $0.id == occurrenceID }) {
                state.occurrences[occurrenceIndex].status = .assigned
            }
        }
    }

    func release(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws {
        try await store.update { state in
            guard let assignmentIndex = state.assignments.firstIndex(where: {
                $0.occurrenceID == occurrenceID && $0.userID == userID && $0.endedAt == nil
            }) else { return }
            state.assignments[assignmentIndex].endedAt = .now
            guard let occurrenceIndex = state.occurrences.firstIndex(where: { $0.id == occurrenceID }) else {
                throw DomainError.entityNotFound
            }
            state.occurrences[occurrenceIndex].status = .available
        }
    }

    nonisolated private func items(from state: MockStore.State) -> [TaskItem] {
        let definitionByID = Dictionary(uniqueKeysWithValues: state.definitions.map { ($0.id, $0) })
        return state.occurrences.compactMap { occurrence in
            guard let definition = definitionByID[occurrence.taskDefinitionID] else { return nil }
            let assignment = state.assignments.first { $0.occurrenceID == occurrence.id && $0.endedAt == nil }
            return TaskItem(definition: definition, occurrence: occurrence, assignment: assignment)
        }
    }
}
