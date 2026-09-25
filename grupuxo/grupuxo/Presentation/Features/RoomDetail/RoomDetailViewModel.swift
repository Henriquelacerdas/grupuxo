import Combine
import Foundation

@MainActor
final class RoomDetailViewModel: ObservableObject {
    @Published var actionError: String?
    @Published private(set) var isCompleting = false
    @Published private(set) var state: RoomDetailState = .idle
    @Published private(set) var suggestions: [TaskSuggestion] = []
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
    private let roomID: Room.ID
    private let userID: User.ID

    init(
        getParticipation: GetRoomParticipationUseCase,
        addMember: AddRoomMemberUseCase,
        removeMember: RemoveRoomMemberUseCase,
        getRoomTasks: GetRoomTasksUseCase,
        getTaskSuggestions: GetTaskSuggestionsUseCase,
        completeTask: CompleteTaskUseCase,
        roomID: Room.ID,
        userID: User.ID
    ) {
        self.getParticipation = getParticipation
        self.addMember = addMember
        self.removeMember = removeMember
        self.getRoomTasks = getRoomTasks
        self.getTaskSuggestions = getTaskSuggestions
        self.completeTask = completeTask
        self.roomID = roomID
        self.userID = userID
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
        !isCompleting && !item.occurrence.isCompleted
            && item.assignment?.userID == userID && item.occurrence.availableAt <= .now
    }

    func complete(_ occurrenceID: TaskOccurrence.ID) async {
        guard !isCompleting else { return }
        isCompleting = true
        defer { isCompleting = false }
        do {
            try await completeTask(occurrenceID: occurrenceID, userID: userID)
            await load()
        } catch { actionError = error.localizedDescription }
    }
}
