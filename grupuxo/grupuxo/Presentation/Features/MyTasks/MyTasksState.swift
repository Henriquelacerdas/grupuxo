enum MyTasksState: Equatable {
    case idle
    case loading
    case content([TaskItem])
    case empty
    case failure(String)
}
