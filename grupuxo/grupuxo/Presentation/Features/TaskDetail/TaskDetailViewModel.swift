//
//  TaskDetailViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class TaskDetailViewModel: ObservableObject {

    @Published private(set) var state: TaskDetailState = .idle
    @Published private(set) var upcoming: [UpcomingAssignment] = []
    @Published private(set) var participation: RoomParticipation?
    @Published private(set) var current: TaskItem?
    @Published private(set) var lastCompleted: TaskItem?
    @Published private(set) var isSaving = false
    @Published private(set) var isPerformingAction = false
    @Published private(set) var wasEnded = false
    @Published var actionError: String?

    private let getTaskOverview: GetTaskOverviewUseCase
    private let getParticipation: GetRoomParticipationUseCase
    private let updateTaskDetails: UpdateTaskDetailsUseCase
    private let completeTask: CompleteTaskUseCase
    private let endTask: EndTaskUseCase

    private let taskDefinitionID: TaskDefinition.ID
    private let userID: User.ID
    private let text: HouseOverviewText
    private var revision = 0
    private var loadID: UUID?

    init(
        getTaskOverview: GetTaskOverviewUseCase,
        getParticipation: GetRoomParticipationUseCase,
        updateTaskDetails: UpdateTaskDetailsUseCase,
        completeTask: CompleteTaskUseCase,
        endTask: EndTaskUseCase,
        taskDefinitionID: TaskDefinition.ID,
        userID: User.ID,
        calendar: Calendar
    ) {

        self.getTaskOverview = getTaskOverview
        self.getParticipation = getParticipation
        self.updateTaskDetails = updateTaskDetails
        self.completeTask = completeTask
        self.endTask = endTask
        self.taskDefinitionID = taskDefinitionID
        self.userID = userID
        self.text = HouseOverviewText(calendar: calendar)

    }

    var currentUserID: User.ID { userID }

    var room: Room? { participation?.room }

    /// "Tarefa de ciclo" segue a escala do cômodo; as demais recorrentes são "extras".
    func kindSummary(of definition: TaskDefinition) -> String {

        switch definition.kind {

        case .sporadic:
            return String(localized: "Tarefa avulsa")

        case .recurring:

            guard let room, definition.isLinked(to: room) else {
                return String(localized: "Tarefa extra")
            }

            return String(localized: "Tarefa de ciclo")

        }

    }

    /// "Termina domingo" para tarefa de ciclo; fora do ciclo, o prazo da vez atual, se houver.
    func deadlineSummary(of definition: TaskDefinition) -> String? {

        if let participation, definition.isLinked(to: participation.room) {

            return text.deadline(
                cycleEnd: participation.periodEnd,
                now: .now
            )

        }

        guard let dueAt = current?.occurrence.dueAt else {
            return nil
        }

        return String(localized: "Prazo: \(dueAt.formatted(date: .abbreviated, time: .omitted))")

    }

    /// Só quem está com a vez atual conclui por aqui.
    var canComplete: Bool {

        !isPerformingAction
            && current?.assignment?.userID == userID
            && current?.occurrence.isCompleted == false

    }

    /// Encerrar vale para tarefa recorrente ainda ativa; a `api` não apaga avulsa.
    func canEnd(_ definition: TaskDefinition) -> Bool {

        !isPerformingAction
            && definition.kind == .recurring
            && definition.endedAt == nil

    }

    func load() async {

        if case .content = state {} else { state = .loading }
        let id = UUID()
        loadID = id
        let currentRevision = revision
        do {

            let overview = try await getTaskOverview(
                taskDefinitionID: taskDefinitionID,
                requesting: userID
            )

            try Task.checkCancellation()
            guard loadID == id, revision == currentRevision else { return }
            upcoming = overview.upcoming
            current = overview.current
            lastCompleted = overview.lastCompleted
            state = .content(overview.definition)

            // O cômodo é secundário: sem ele a tela mostra o resto.
            let participation = try? await getParticipation(
                roomID: overview.definition.roomID,
                userID: userID
            )
            guard loadID == id, revision == currentRevision else { return }
            self.participation = participation

        } catch is CancellationError {
            // A tela saiu antes da resposta.
        } catch {
            guard loadID == id, revision == currentRevision else { return }
            if case .content = state {
                actionError = error.localizedDescription
                return
            }
            state = .failure(
                error.localizedDescription
            )

        }

    }

    func complete() async {

        guard canComplete, let previous = current else {
            return
        }

        revision += 1
        let occurrenceID = previous.id
        var preview = OptimisticTaskCompletions()
        preview.begin(previous, by: userID)
        current = preview.applying(to: previous)
        isPerformingAction = true

        defer {
            isPerformingAction = false
        }

        do {

            try await completeTask(
                occurrenceID: occurrenceID,
                userID: userID
            )

            revision += 1
            actionError = nil
            await load()

        } catch {
            revision += 1
            current = previous
            actionError =
                error.localizedDescription

        }

    }

    /// Encerra a tarefa: o histórico fica e a vez atual continua até ser concluída.
    func end() async {

        guard case let .content(definition) = state,
              canEnd(definition)
        else {
            return
        }

        isPerformingAction = true

        defer {
            isPerformingAction = false
        }

        do {

            try await endTask(
                taskID: definition.id,
                requestedBy: userID
            )

            actionError = nil
            wasEnded = true

        } catch {

            actionError =
                error.localizedDescription

        }

    }

    func update(
        name: String,
        details: String
    ) async -> Bool {

        guard !isSaving else {
            return false
        }

        isSaving = true

        defer {
            isSaving = false
        }

        do {

            let updatedDefinition =
                try await updateTaskDetails(
                    id: taskDefinitionID,
                    name: name,
                    details: details,
                    requestedBy: userID
                )

            state = .content(
                updatedDefinition
            )

            actionError = nil

            return true

        } catch {

            actionError =
                error.localizedDescription

            return false

        }

    }

}
