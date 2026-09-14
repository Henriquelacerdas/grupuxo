struct RoomDetailContent: Equatable {
    let room: Room
    let tasks: [TaskItem]
}

enum RoomDetailState: Equatable {
    case idle
    case loading
    case content(RoomDetailContent)
    case empty(Room)
    case failure(String)
}
