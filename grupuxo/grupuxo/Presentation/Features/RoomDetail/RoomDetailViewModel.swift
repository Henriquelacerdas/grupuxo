import Combine
import Foundation

@MainActor
final class RoomDetailViewModel: ObservableObject {
    @Published private(set) var state: RoomDetailState = .idle
    private let roomRepository: any RoomRepository
    private let getRoomTasks: GetRoomTasksUseCase
    private let roomID: Room.ID
    private let userID: User.ID

    init(roomRepository: any RoomRepository, getRoomTasks: GetRoomTasksUseCase, roomID: Room.ID, userID: User.ID) {
        self.roomRepository = roomRepository
        self.getRoomTasks = getRoomTasks
        self.roomID = roomID
        self.userID = userID
    }

    func load() async {
        state = .loading
        do {
            async let room = roomRepository.room(id: roomID)
            async let tasks = getRoomTasks(roomID: roomID, userID: userID)
            let content = try await RoomDetailContent(room: room, tasks: tasks)
            state = content.tasks.isEmpty ? .empty(content.room) : .content(content)
        } catch {
            state = .failure(error.localizedDescription)
        }
    }
}
