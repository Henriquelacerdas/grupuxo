// TODO — Conectar escolhas de periodicidade ao draft e enviar contexto de usuário/
// casa ao caso de uso para validar o cômodo selecionado. Carregar apenas cômodos
// autorizados. Evitar salvar novamente enquanto .saving ou após sucesso sem edição.
// TaskEffort hoje limita valores ao intervalo; se houver entrada livre, validar
// 1...3 antes de construir o valor para informar o erro em vez de corrigir em silêncio.

import Combine
import Foundation

@MainActor
final class TaskEditorViewModel: ObservableObject {
    @Published private(set) var state: TaskEditorState
    @Published private(set) var rooms: [Room] = []
    private let createTask: CreateTaskUseCase
    private let getHouseRooms: GetHouseRoomsUseCase
    private let houseID: House.ID
    private let ownerUserID: User.ID

    init(
        createTask: CreateTaskUseCase,
        getHouseRooms: GetHouseRoomsUseCase,
        houseID: House.ID,
        ownerUserID: User.ID,
        draft: TaskDraft
    ) {
        self.createTask = createTask
        self.getHouseRooms = getHouseRooms
        self.houseID = houseID
        self.ownerUserID = ownerUserID
        state = .editing(draft)
    }

    func loadRooms() async {
        do {
            rooms = try await getHouseRooms(houseID: houseID)
        } catch {
            state = .failure(state.draft, error.localizedDescription)
        }
    }

    func updateDraft(_ update: (inout TaskDraft) -> Void) {
        if case .saving = state { return }
        var draft = state.draft
        update(&draft)
        state = .editing(draft)
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
            id: UUID(),
            roomID: roomID,
            name: draft.name,
            details: draft.details,
            effort: TaskEffort(points: draft.effortPoints),
            kind: draft.kind,
            visibility: draft.visibility,
            recurrence: draft.recurrence,
            assignmentPolicy: draft.assignmentPolicy,
            ownerUserID: draft.visibility == .privateTask ? ownerUserID : nil
        )
        do {
            state = .saved(try await createTask(definition: definition))
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
