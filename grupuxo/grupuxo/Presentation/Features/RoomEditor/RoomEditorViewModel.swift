import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class RoomEditorViewModel: ObservableObject {
    @Published private(set) var state: RoomEditorState
    @Published private(set) var residents: [User] = []
    @Published private(set) var residentsError: String?
    @Published private(set) var isLoadingResidents = false

    private let createRoom: CreateRoomUseCase
    private let houseID: House.ID
    private let creatorUserID: User.ID
    private let getMembers: GetHouseMembersUseCase?
    private let onCreated: (@MainActor (Room) async throws -> Void)?
    /// Cômodo sendo editado (nome, aparência e ciclo); `nil` = criando um novo.
    private let editing: Room?
    private let updateRoom: UpdateRoomUseCase?

    var isEditing: Bool { editing != nil }

    /// O formulário como abriu: a sheet só avisa de descarte se algo mudou.
    let initialDraft: RoomDraft

    var maximumResponsibleCount: Int { max(1, residents.count) }

    var canSave: Bool {
        !state.draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    init(
        createRoom: CreateRoomUseCase,
        houseID: House.ID,
        creatorUserID: User.ID,
        draft: RoomDraft = RoomDraft(),
        getMembers: GetHouseMembersUseCase? = nil,
        editing: Room? = nil,
        updateRoom: UpdateRoomUseCase? = nil,
        onCreated: (@MainActor (Room) async throws -> Void)? = nil
    ) {
        self.createRoom = createRoom
        self.houseID = houseID
        self.creatorUserID = creatorUserID
        self.getMembers = getMembers
        self.onCreated = onCreated
        self.editing = editing
        self.updateRoom = updateRoom
        var draft = draft
        if let editing {
            draft = RoomDraft(
                name: editing.name, category: editing.category, icon: editing.icon, color: editing.color,
                periodicity: editing.periodicity, responsibleCount: editing.responsibleCount,
                visibility: editing.visibility
            )
        } else {
            draft.responsibleCount = 1
        }
        draft.selectedParticipantIDs.insert(creatorUserID)
        initialDraft = draft
        state = .editing(draft)
    }

    func isCreator(_ userID: User.ID) -> Bool { userID == creatorUserID }

    func loadResidents() async {
        guard let getMembers else { return }
        isLoadingResidents = true
        residentsError = nil
        defer { isLoadingResidents = false }
        do {
            residents = try await getMembers(houseID: houseID, userID: creatorUserID)
            updateDraft { _ in }
        }
        catch is CancellationError {}
        catch { residentsError = error.localizedDescription }
    }

    func updateDraft(_ update: (inout RoomDraft) -> Void) {
        if case .saving = state { return }
        var draft = state.draft
        update(&draft)
        draft.responsibleCount = min(max(1, draft.responsibleCount), maximumResponsibleCount)
        draft.periodicity.executionsPerPeriod = min(
            draft.periodicity.executionsPerPeriod, draft.periodicity.intervalWeeks * 7
        )
        state = .editing(draft)
    }

    /// O que mudou em relação ao cômodo aberto; vazio = nada a gravar.
    private func patch(for draft: RoomDraft, from room: Room) -> RoomPatch {
        RoomPatch(
            name: draft.name == room.name ? nil : draft.name,
            category: draft.category == room.category ? nil : draft.category,
            icon: draft.icon == room.icon ? nil : draft.icon,
            color: draft.color == room.color ? nil : draft.color,
            periodicity: draft.periodicity == room.periodicity ? nil : draft.periodicity,
            responsibleCount: draft.responsibleCount == room.responsibleCount ? nil : draft.responsibleCount
        )
    }

    private func saveEdit(_ room: Room, draft: RoomDraft) async {
        state = .saving(draft)
        let patch = patch(for: draft, from: room)
        guard !patch.isEmpty else {
            state = .saved(room)
            return
        }
        do {
            guard let updateRoom else { throw APIError.unsupported }
            let updated = try await updateRoom(roomID: room.id, patch: patch, userID: creatorUserID)
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
        state = .saving(draft)
        do {
            let room = try await createRoom(
                name: draft.name, houseID: houseID, creatorUserID: creatorUserID,
                category: draft.category, visibility: draft.visibility,
                periodicity: draft.periodicity, responsibleCount: draft.responsibleCount,
                icon: draft.icon, color: draft.color,
                selectedParticipantIDs: draft.selectedParticipantIDs
            )
            // Se a gravação real falhar, o erro volta ao formulário; quem passou o callback desfaz o Mock.
            try await onCreated?(room)
            state = .saved(room)
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
