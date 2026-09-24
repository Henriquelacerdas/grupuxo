import Combine
import Foundation

@MainActor
final class RoomDetailViewModel: ObservableObject {

    @Published var actionError: String?
    @Published private(set) var isCompleting = false
    @Published private(set) var state: RoomDetailState = .idle
    @Published private(set) var suggestions: [TaskSuggestion] = []

    private let roomRepository: any RoomRepository
    private let getRoomTasks: GetRoomTasksUseCase
    private let getTaskSuggestions: GetTaskSuggestionsUseCase
    private let roomID: Room.ID
    private let completeTask: CompleteTaskUseCase
    private let userID: User.ID

    init(
        roomRepository: any RoomRepository,
        getRoomTasks: GetRoomTasksUseCase,
        getTaskSuggestions: GetTaskSuggestionsUseCase,
        completeTask: CompleteTaskUseCase,
        roomID: Room.ID,
        userID: User.ID
    ) {
        self.roomRepository = roomRepository
        self.getRoomTasks = getRoomTasks
        self.getTaskSuggestions = getTaskSuggestions
        self.roomID = roomID
        self.completeTask = completeTask
        self.userID = userID
    }

    func load() async {

        state = .loading

        do {

            async let roomRequest = roomRepository.room(
                id: roomID,
                requesting: userID
            )

            async let tasksRequest = getRoomTasks(
                roomID: roomID,
                userID: userID
            )

            let (room, tasks) = try await (
                roomRequest,
                tasksRequest
            )

            let usedSuggestionIDs = Set(
                tasks.compactMap {
                    $0.definition.sourceSuggestionID
                }
            )

            suggestions = getTaskSuggestions(
                category: room.category
            )
            .filter { suggestion in
                !usedSuggestionIDs.contains(
                    suggestion.id
                )
            }

            let content = RoomDetailContent(
                room: room,
                tasks: tasks
            )

            state = tasks.isEmpty
                ? .empty(room)
                : .content(content)

        } catch {

            suggestions = []

            state = .failure(
                error.localizedDescription
            )
        }
    }

    func canComplete(
        _ item: TaskItem
    ) -> Bool {

        !isCompleting
            && !item.occurrence.isCompleted
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= .now
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isCompleting else {
            return
        }

        isCompleting = true

        defer {
            isCompleting = false
        }

        do {

            try await completeTask(
                occurrenceID: occurrenceID,
                userID: userID
            )

            await load()

        } catch {

            actionError = error.localizedDescription
        }
    }
}
