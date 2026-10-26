import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class RoomDetailViewModel: ObservableObject {
    @Published var actionError: String?
    @Published private(set) var isCompleting = false
    @Published private(set) var state: RoomDetailState = .idle
    @Published private(set) var suggestions: [TaskSuggestion] = []
    @Published private var suggestionOffset = 0
    @Published private(set) var participation: RoomParticipation?
    @Published private(set) var isChangingMembership = false
    @Published private(set) var wasDeleted = false
    @Published var confirmsDeletion = false

    private let getParticipation: GetRoomParticipationUseCase
    private let addMember: AddRoomMemberUseCase
    private let removeMember: RemoveRoomMemberUseCase
    private let getRoomTasks: GetRoomTasksUseCase
    private let getTaskSuggestions: GetTaskSuggestionsUseCase
    private let completeTask: CompleteTaskUseCase
    private let endTask: EndTaskUseCase
    private let claimTask: ClaimSporadicTaskUseCase
    private let roomID: Room.ID
    private let userID: User.ID
    private let text: HouseOverviewText

    /// Quantas sugestões aparecem de uma vez; "Outras sugestões" avança para o próximo grupo.
    static let suggestionPageSize = 3

    init(
        getParticipation: GetRoomParticipationUseCase,
        addMember: AddRoomMemberUseCase,
        removeMember: RemoveRoomMemberUseCase,
        getRoomTasks: GetRoomTasksUseCase,
        getTaskSuggestions: GetTaskSuggestionsUseCase,
        completeTask: CompleteTaskUseCase,
        endTask: EndTaskUseCase,
        claimTask: ClaimSporadicTaskUseCase,
        roomID: Room.ID,
        userID: User.ID,
        calendar: Calendar
    ) {
        self.getParticipation = getParticipation
        self.addMember = addMember
        self.removeMember = removeMember
        self.getRoomTasks = getRoomTasks
        self.getTaskSuggestions = getTaskSuggestions
        self.completeTask = completeTask
        self.endTask = endTask
        self.claimTask = claimTask
        self.roomID = roomID
        self.userID = userID
        self.text = HouseOverviewText(calendar: calendar)
    }

    var currentUserID: User.ID { userID }

    /// "Você e Julia C.": quem está com as tarefas do ciclo do cômodo agora. Sem tarefas do
    /// ciclo atribuídas, cai nos responsáveis do período calculados para o cômodo.
    var responsiblesSummary: String? {
        guard let participation else { return nil }

        let assignees = cycleAssignees(in: participation.room)

        if !assignees.isEmpty {
            return text.responsibles(
                names: assignees.map(\.name),
                userIDs: assignees.map(\.id),
                currentUserID: userID
            )
        }

        return text.responsibles(
            names: participation.responsibleNames,
            userIDs: participation.responsibleUserIDs,
            currentUserID: userID
        )
    }

    /// "Semanal", "Quinzenal"...
    var cycleDurationSummary: String? {
        participation.map { RoomDetailText.cycleDuration($0.room.periodicity) }
    }

    /// "Todos • público".
    var participantsSummary: String? {
        participation.map {
            RoomDetailText.participants(of: $0.room, memberCount: $0.memberCount)
        }
    }

    /// Moradores com alguma tarefa do ciclo (mesma periodicidade do cômodo), sem repetir,
    /// em ordem estável pelo ID.
    private func cycleAssignees(in room: Room) -> [User] {
        guard case let .content(content) = state else { return [] }

        let assignees = content.tasks
            .filter { $0.definition.kind == .recurring && $0.definition.isLinked(to: room) }
            .compactMap(\.assignee)

        return Dictionary(grouping: assignees, by: \.id)
            .compactMap { $0.value.first }
            .sorted { $0.id.uuidString.lowercased() < $1.id.uuidString.lowercased() }
    }

    /// "Termina domingo".
    var deadlineSummary: String? {
        guard let participation else { return nil }
        return text.deadline(cycleEnd: participation.periodEnd, now: .now)
    }

    /// O grupo atual de sugestões, girando pela lista quando "Outras sugestões" é tocado.
    var visibleSuggestions: [TaskSuggestion] {
        guard !suggestions.isEmpty else { return [] }
        let size = Self.suggestionPageSize
        return (0..<min(size, suggestions.count)).map {
            suggestions[(suggestionOffset + $0) % suggestions.count]
        }
    }

    var hasOtherSuggestions: Bool { suggestions.count > Self.suggestionPageSize }

    func showOtherSuggestions() {
        guard hasOtherSuggestions else { return }
        suggestionOffset = (suggestionOffset + Self.suggestionPageSize) % suggestions.count
    }

    func canClaim(_ item: TaskItem) -> Bool {
        !isCompleting
            && participation?.isMember == true
            && item.definition.kind == .sporadic
            && item.definition.endedAt == nil
            && !item.occurrence.isCompleted
            && item.assignment == nil
    }

    func claim(_ occurrenceID: TaskOccurrence.ID) async {
        guard case let .content(content) = state,
              let item = content.tasks.first(where: { $0.id == occurrenceID }),
              canClaim(item) else { return }
        isCompleting = true
        defer { isCompleting = false }
        do {
            try await claimTask(occurrenceID: occurrenceID, userID: userID)
            await load()
        } catch { actionError = error.localizedDescription }
    }

    func load() async {
        state = .loading
        do {
            let participation = try await getParticipation(roomID: roomID, userID: userID)
            self.participation = participation
            let tasks = try await getRoomTasks(roomID: roomID, userID: userID)
            let usedSuggestionIDs = Set(tasks.compactMap(\.definition.sourceSuggestionID))
            suggestions = participation.isMember
                ? getTaskSuggestions(category: participation.room.category).filter {
                    !usedSuggestionIDs.contains($0.id)
                }
                : []
            let content = RoomDetailContent(room: participation.room, tasks: tasks)
            state = tasks.isEmpty ? .empty(content.room) : .content(content)
        } catch is CancellationError {
            // A tela saiu antes da resposta.
        } catch {
            suggestions = []
            state = .failure(error.localizedDescription)
        }
    }

    func join() async {
        guard !isChangingMembership else { return }
        isChangingMembership = true
        defer { isChangingMembership = false }
        do {
            try await addMember(userID: userID, roomID: roomID)
            await load()
        } catch { actionError = error.localizedDescription }
    }

    func leave(confirmDeletion: Bool = false) async {
        guard !isChangingMembership else { return }
        if participation?.memberCount == 1 && !confirmDeletion {
            confirmsDeletion = true
            return
        }
        isChangingMembership = true
        defer { isChangingMembership = false }
        do {
            try await removeMember(
                userID: userID, roomID: roomID, confirmDeletion: confirmDeletion
            )
            do { _ = try await getParticipation(roomID: roomID, userID: userID) }
            catch DomainError.entityNotFound { wasDeleted = true; return }
            await load()
        } catch DomainError.deletionConfirmationRequired {
            confirmsDeletion = true
        } catch {
            actionError = error.localizedDescription
        }
    }

    func canComplete(_ item: TaskItem) -> Bool {
        !isCompleting
            && item.assignment?.userID == userID && item.occurrence.availableAt <= .now
    }

    func complete(_ occurrenceID: TaskOccurrence.ID) async {
        guard !isCompleting else { return }
        guard case let .content(content) = state,
              let item = content.tasks.first(where: { $0.id == occurrenceID }),
              canComplete(item) else { return }
        isCompleting = true
        defer { isCompleting = false }
        do {
            try await completeTask(occurrenceID: occurrenceID, userID: userID, isCompleted: !item.occurrence.isCompleted)
            await load()
        } catch { actionError = error.localizedDescription }
    }

    /// Encerra a tarefa: o histórico fica e a ocorrência da vez continua até ser concluída.
    @discardableResult
    func end(taskID: TaskDefinition.ID) async -> Bool {
        do {
            try await endTask(taskID: taskID, requestedBy: userID)
            await load()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }
}
