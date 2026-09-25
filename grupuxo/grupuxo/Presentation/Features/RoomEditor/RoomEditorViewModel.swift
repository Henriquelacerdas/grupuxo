import Combine
import Foundation

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

    var canSave: Bool {
        !state.draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    init(
        createRoom: CreateRoomUseCase,
        houseID: House.ID,
        creatorUserID: User.ID,
        draft: RoomDraft = RoomDraft(),
        getMembers: GetHouseMembersUseCase? = nil
    ) {
        self.createRoom = createRoom
        self.houseID = houseID
        self.creatorUserID = creatorUserID
        self.getMembers = getMembers
        var draft = draft
        draft.selectedParticipantIDs.insert(creatorUserID)
        state = .editing(draft)
    }

    func isCreator(_ userID: User.ID) -> Bool { userID == creatorUserID }

    func loadResidents() async {
        guard let getMembers else { return }
        isLoadingResidents = true
        residentsError = nil
        defer { isLoadingResidents = false }
        do { residents = try await getMembers(houseID: houseID, userID: creatorUserID) }
        catch { residentsError = error.localizedDescription }
    }

    func updateDraft(_ update: (inout RoomDraft) -> Void) {
        if case .saving = state { return }
        var draft = state.draft
        update(&draft)
        draft.periodicity.executionsPerPeriod = min(
            draft.periodicity.executionsPerPeriod, draft.periodicity.intervalWeeks * 7
        )
        state = .editing(draft)
    }

    func save() async {
        switch state {
        case .saving, .saved: return
        case .editing, .failure: break
        }
        let draft = state.draft
        state = .saving(draft)
        do {
            state = .saved(try await createRoom(
                name: draft.name, houseID: houseID, creatorUserID: creatorUserID,
                category: draft.category, visibility: draft.visibility,
                periodicity: draft.periodicity, responsibleCount: draft.responsibleCount,
                icon: draft.icon, color: draft.color,
                selectedParticipantIDs: draft.selectedParticipantIDs
            ))
        } catch {
            state = .failure(draft, error.localizedDescription)
        }
    }
}
