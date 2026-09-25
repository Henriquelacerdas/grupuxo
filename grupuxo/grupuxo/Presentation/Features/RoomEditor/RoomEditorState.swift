import Foundation

struct RoomDraft: Equatable {
    var name = ""
    var category: RoomCategory = .other
    var icon = "house.fill"
    var color: RoomColor = .blue
    var selectedParticipantIDs: Set<User.ID> = []
    var periodicity = WeeklyPeriodicity()
    var responsibleCount = 1
    var visibility: RoomVisibility = .common
}

enum RoomEditorState: Equatable {
    case editing(RoomDraft), saving(RoomDraft), saved(Room), failure(RoomDraft, String)

    var draft: RoomDraft {
        switch self {
        case let .editing(draft), let .saving(draft), let .failure(draft, _): return draft
        case let .saved(room):
            return RoomDraft(name: room.name, category: room.category, icon: room.icon, color: room.color,
                             periodicity: room.periodicity, responsibleCount: room.responsibleCount,
                             visibility: room.visibility)
        }
    }
}
