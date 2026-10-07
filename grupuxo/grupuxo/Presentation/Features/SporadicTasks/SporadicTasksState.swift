import Foundation

struct SporadicTaskCardItem: Identifiable, Equatable {

    let task: TaskItem
    let room: Room
    let creator: User?

    var id: TaskOccurrence.ID {
        task.id
    }

}

enum SporadicTasksState: Equatable {

    case idle
    case loading
    case content([SporadicTaskCardItem])
    case empty
    case failure(String)

}
