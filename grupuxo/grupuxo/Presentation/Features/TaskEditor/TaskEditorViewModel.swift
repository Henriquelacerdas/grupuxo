import Combine
import Foundation
import GrupuxoDomain

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
            var draft = state.draft
            syncWithRoom(&draft)
            if draft != state.draft { state = .editing(draft) }
        } catch is CancellationError {
            // A tela saiu antes da resposta.
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
        syncWithRoom(&draft)
        state = .editing(draft)
    }

    /// Cômodo escolhido no rascunho, se já carregado.
    var selectedRoom: Room? {
        rooms.first { $0.id == state.draft.roomID }
    }

    /// Liga ou desliga "Repetir com o cômodo". Desligado, a tarefa ganha uma repetição própria
    /// diferente da do cômodo (com a mesma, ela entraria no ciclo de qualquer jeito).
    func setFollowsRoom(_ followsRoom: Bool) {
        updateDraft { draft in
            draft.followsRoom = followsRoom
            if !followsRoom {
                draft.recurrence = Self.ownRecurrenceCandidates.first { !isRoomPeriodicity($0) }
                    ?? draft.recurrence
            }
        }
    }

    /// Escolha de repetição própria (só com "Repetir com o cômodo" desligado).
    func selectRecurrence(_ recurrence: RecurrencePolicy) {
        updateDraft {
            $0.followsRoom = false
            $0.recurrence = recurrence
        }
    }

    /// A repetição é a mesma do cômodo escolhido (e por isso não serve como repetição própria).
    func isRoomPeriodicity(_ recurrence: RecurrencePolicy) -> Bool {
        guard let room = selectedRoom else { return false }
        return recurrence.weeklyPeriodicity == room.periodicity
    }

    private static let ownRecurrenceCandidates: [RecurrencePolicy] = [
        .recurring(frequency: .weekly, interval: 2),
        .recurring(frequency: .monthly, interval: 1),
        .recurring(frequency: .weekly, interval: 1),
    ]

    /// Com "Repetir com o cômodo", a repetição é sempre a periodicidade do cômodo escolhido.
    private func syncWithRoom(_ draft: inout TaskDraft) {
        guard draft.kind == .recurring, draft.followsRoom,
              let room = rooms.first(where: { $0.id == draft.roomID }) else { return }
        draft.recurrence = .weekly(room.periodicity)
    }

    func save() async {
        switch state {
        case .saving, .saved: return
        case .editing, .failure: break
        }
        let draft = state.draft
        guard let roomID = draft.roomID else {
            state = .failure(draft, String(localized: "Selecione um cômodo."))
            return
        }
        state = .saving(draft)
        let definition = TaskDefinition(
            id: UUID(), roomID: roomID, name: draft.name, details: draft.details,
            effort: TaskEffort(points: draft.effortPoints), kind: draft.kind,
            recurrence: draft.recurrence, assignmentPolicy: draft.assignmentPolicy,
            sourceSuggestionID: draft.sourceSuggestionID,
            createdByUserID: requestingUserID
        )
        do {
            state = .saved(try await createTask(definition: definition, requestedBy: requestingUserID))
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
