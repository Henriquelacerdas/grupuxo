import Combine
import Foundation

@MainActor
final class RoomDetailViewModel: ObservableObject {

    @Published var actionError: String?
    @Published private(set) var isCompleting = false
    @Published private(set) var state: RoomDetailState = .idle

    private let roomRepository: any RoomRepository
    private let getRoomTasks: GetRoomTasksUseCase

    private let roomID: Room.ID
    private let completeTask: CompleteTaskUseCase
    private let userID: User.ID

    init(
        roomRepository: any RoomRepository,
        getRoomTasks: GetRoomTasksUseCase,
        completeTask: CompleteTaskUseCase,
        roomID: Room.ID,
        userID: User.ID
    ) {
        self.roomRepository = roomRepository
        self.getRoomTasks = getRoomTasks
        self.roomID = roomID
        self.completeTask = completeTask
        self.userID = userID
    }

    func load() async {

        state = .loading

        do {

            async let room = roomRepository.room(
                id: roomID,
                requesting: userID
            )

            async let tasks = getRoomTasks(
                roomID: roomID,
                userID: userID
            )

            let content = try await RoomDetailContent(
                room: room,
                tasks: tasks
            )

            state = content.tasks.isEmpty
                ? .empty(content.room)
                : .content(content)

        } catch {

            state = .failure(
                error.localizedDescription
            )
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
        } catch {
            actionError = error.localizedDescription
        }
    }
}
