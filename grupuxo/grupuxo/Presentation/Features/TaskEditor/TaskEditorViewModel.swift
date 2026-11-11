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
    /// Tarefa sendo editada; `nil` = criando uma nova. O cômodo, o tipo (única ou recorrente) e "Repetir com o
    /// cômodo" não mudam na edição; só nome, descrição, esforço e, na repetição própria, o intervalo.
    private let editing: TaskDefinition?
    private let updateTask: UpdateTaskDetailsUseCase?

    var isEditing: Bool { editing != nil }

    /// O formulário como abriu: a edição só salva se algo mudou.
    let initialDraft: TaskDraft

    /// Só a repetição própria (política por conclusão) muda o intervalo.
    var canEditRecurrence: Bool {
        guard let editing else { return true }
        return editing.kind == .recurring && editing.assignmentPolicy == .afterCompletion
    }

    init(
        createTask: CreateTaskUseCase,
        getHouseRooms: GetHouseRoomsUseCase,
        houseID: House.ID,
        requestingUserID: User.ID,
        draft: TaskDraft,
        editing: TaskDefinition? = nil,
        updateTask: UpdateTaskDetailsUseCase? = nil
    ) {
        self.createTask = createTask
        self.getHouseRooms = getHouseRooms
        self.houseID = houseID
        self.requestingUserID = requestingUserID
        self.editing = editing
        self.updateTask = updateTask
        var draft = draft
        if let editing {
            draft = TaskDraft(
                name: editing.name, details: editing.details, roomID: editing.roomID,
                effortPoints: editing.effort.points, sourceSuggestionID: editing.sourceSuggestionID,
                kind: editing.kind, recurrence: editing.recurrence, assignmentPolicy: editing.assignmentPolicy,
                // Definição antiga (sem o campo): decidida quando os cômodos carregam (`loadRooms`).
                followsRoom: editing.followsRoom ?? (editing.kind == .recurring && editing.assignmentPolicy != .afterCompletion)
            )
        }
        initialDraft = draft
        state = .editing(draft)
    }

    func loadRooms() async {
        do {
            rooms = try await getHouseRooms(
                houseID: houseID, userID: requestingUserID, participatingOnly: true
            )
            var draft = state.draft
            if let editing, editing.followsRoom == nil, let room = rooms.first(where: { $0.id == editing.roomID }) {
                draft.followsRoom = editing.isLinked(to: room)
            }
            // Ao editar, a recorrência guardada é a verdade (a da repetição própria não deriva do cômodo).
            if !isEditing || draft.followsRoom { syncWithRoom(&draft) }
            if !isEditing { applyDefaultRoom(&draft) }
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
        if !isEditing, draft.kind != previous.kind { applyDefaultRoom(&draft) }
        state = .editing(draft)
    }

    /// Tarefa única sem cômodo escolhido cai em "Casa toda" (o cômodo que inclui todo mundo).
    private func applyDefaultRoom(_ draft: inout TaskDraft) {
        guard draft.kind == .sporadic, draft.roomID == nil,
              let wholeHouse = rooms.first(where: \.representsWholeHouse) else { return }
        draft.roomID = wholeHouse.id
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

    /// Grava a edição: só o que mudou vai ao servidor (esforço e intervalo só quando mudam).
    private func saveEdit(_ definition: TaskDefinition, draft: TaskDraft) async {
        state = .saving(draft)
        let effort = draft.effortPoints == definition.effort.points ? nil : TaskEffort(points: draft.effortPoints)
        let recurrence = canEditRecurrence && draft.recurrence != definition.recurrence ? draft.recurrence : nil
        do {
            guard let updateTask else { throw APIError.unsupported }
            let updated = try await updateTask(
                id: definition.id, name: draft.name, details: draft.details, effort: effort,
                recurrence: recurrence, requestedBy: requestingUserID
            )
            state = .saved(updated)
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }

    func save() async {
        switch state {
        case .saving, .saved: return
        case .editing, .failure: break
        }
        let draft = state.draft
        if let editing {
            await saveEdit(editing, draft: draft)
            return
        }
        guard let roomID = draft.roomID else {
            state = .failure(draft, String(localized: "Selecione um cômodo."))
            return
        }
        state = .saving(draft)
        let isOwnRepetition = draft.kind == .recurring && !draft.followsRoom
        // Repetição própria (docs/DESIGN.md): cada vez a pessoa tem 2 dias e a próxima abre um intervalo depois de
        // feita. É a política "por conclusão" com o intervalo escolhido.
        let policy: TaskAssignmentPolicy = isOwnRepetition
            && [.balancedAutomatically, .calendarRotation].contains(draft.assignmentPolicy)
            ? .afterCompletion : draft.assignmentPolicy
        let definition = TaskDefinition(
            id: UUID(), roomID: roomID, name: draft.name, details: draft.details,
            effort: TaskEffort(points: draft.effortPoints), kind: draft.kind,
            recurrence: draft.recurrence, assignmentPolicy: policy,
            sourceSuggestionID: draft.sourceSuggestionID,
            createdByUserID: requestingUserID,
            followsRoom: draft.kind == .recurring ? draft.followsRoom : nil
        )
        do {
            state = .saved(try await createTask(definition: definition, requestedBy: requestingUserID))
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
