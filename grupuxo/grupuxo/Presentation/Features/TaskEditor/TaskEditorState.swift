import Foundation

struct TaskDraft: Equatable {
    var name = ""
    var details = ""
    var roomID: Room.ID?
    var effortPoints = 1
    var kind = TaskKind.recurring
    var visibility = TaskVisibility.house
    var recurrence = RecurrencePolicy.recurring(frequency: .weekly, interval: 1)
    var assignmentPolicy = TaskAssignmentPolicy.balancedAutomatically
}

enum TaskEditorState: Equatable {
    case editing(TaskDraft)
    case saving(TaskDraft)
    case saved(TaskDefinition)
    case failure(TaskDraft, String)

    var draft: TaskDraft {
        switch self {
        case let .editing(draft), let .saving(draft), let .failure(draft, _): draft
        case let .saved(definition):
            TaskDraft(
                name: definition.name,
                details: definition.details,
                roomID: definition.roomID,
                effortPoints: definition.effort.points,
                kind: definition.kind,
                visibility: definition.visibility,
                recurrence: definition.recurrence,
                assignmentPolicy: definition.assignmentPolicy
            )
        }
    }
}
