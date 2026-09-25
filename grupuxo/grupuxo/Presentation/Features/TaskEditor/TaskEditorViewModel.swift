import Combine
import Foundation

@MainActor
final class TaskEditorViewModel: ObservableObject {
    @Published private(set) var state: TaskEditorState
    @Published private(set) var rooms: [Room] = []
    private let createTask: CreateTaskUseCase
    private let getHouseRooms: GetHouseRoomsUseCase
    private let houseID: House.ID
    private let requestingUserID: User.ID

    init(
        createTask: CreateTaskUseCase,
        getHouseRooms: GetHouseRoomsUseCase,
        houseID: House.ID,
        requestingUserID: User.ID,
        draft: TaskDraft
    ) {
        self.createTask = createTask
        self.getHouseRooms = getHouseRooms
        self.houseID = houseID
        self.requestingUserID = requestingUserID
        state = .editing(draft)
    }

    func loadRooms() async {
        do {
            rooms = try await getHouseRooms(
                houseID: houseID, userID: requestingUserID, participatingOnly: true
            )
        } catch {
            state = .failure(state.draft, error.localizedDescription)
        }
    }

    func updateDraft(_ update: (inout TaskDraft) -> Void) {
        if case .saving = state { return }
        let previous = state.draft
        var draft = previous
        update(&draft)

        if draft.kind != previous.kind {
            draft.recurrence = draft.kind == .sporadic
                ? .none : .recurring(frequency: .weekly, interval: 1)
            draft.assignmentPolicy = draft.kind == .sporadic ? .selfAssigned : .balancedAutomatically
        } else if draft.assignmentPolicy != previous.assignmentPolicy {
            switch draft.assignmentPolicy {
            case .selfAssigned:
                draft.kind = .sporadic
                draft.recurrence = .none
            case .afterCompletion:
                draft.kind = .recurring
                draft.recurrence = .none
            case .balancedAutomatically, .calendarRotation:
                draft.kind = .recurring
                if draft.recurrence == .none {
                    draft.recurrence = .recurring(frequency: .weekly, interval: 1)
                }
            }
        } else if draft.recurrence != previous.recurrence {
            draft.kind = draft.recurrence == .none ? .sporadic : .recurring
            draft.assignmentPolicy = draft.kind == .sporadic ? .selfAssigned : .balancedAutomatically
        }
        state = .editing(draft)
    }

    func useRoomPeriodicity() {
        guard let room = rooms.first(where: { $0.id == state.draft.roomID }) else { return }
        selectRecurrence(.weekly(room.periodicity))
    }

    func selectRecurrence(_ recurrence: RecurrencePolicy) {
        updateDraft { $0.recurrence = recurrence }
    }

    func save() async {
        switch state {
        case .saving, .saved: return
        case .editing, .failure: break
        }
        let draft = state.draft
        guard let roomID = draft.roomID else {
            state = .failure(draft, "Selecione um cômodo.")
            return
        }
        state = .saving(draft)
        let definition = TaskDefinition(
            id: UUID(), roomID: roomID, name: draft.name, details: draft.details,
            effort: TaskEffort(points: draft.effortPoints), kind: draft.kind,
            recurrence: draft.recurrence, assignmentPolicy: draft.assignmentPolicy,
            sourceSuggestionID: draft.sourceSuggestionID
        )
        do {
            state = .saved(try await createTask(definition: definition, requestedBy: requestingUserID))
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
