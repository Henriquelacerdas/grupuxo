enum AppRoute: Hashable {
    case roomDetail(Room.ID)
    case sporadicTasks
    case taskEditor(roomID: Room.ID?)
    case notifications
    case settings
}

enum AppTab: Hashable {
    case myTasks
    case house
}
