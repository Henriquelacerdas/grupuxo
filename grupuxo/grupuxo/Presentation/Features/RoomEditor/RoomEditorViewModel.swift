//
//   RoomEditorViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 18/09/26.
//

import Combine
import Foundation

@MainActor
final class RoomEditorViewModel: ObservableObject {

    @Published private(set) var state: RoomEditorState

    @Published private(set) var residents: [User] = []
    @Published private(set) var residentsError: String?
    @Published private(set) var isLoadingResidents = false
    private let getMembers: GetHouseMembersUseCase?

    var canSave: Bool {
        !state.draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

    private let createRoom: CreateRoomUseCase

    private let houseID: House.ID
    private let creatorUserID: User.ID

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
        self.state = .editing(draft)
    }

    func updateDraft(
        _ update: (inout RoomDraft) -> Void
    ) {

        if case .saving = state {
            return
        }

        var draft = state.draft

        update(&draft)
        draft.periodicity.executionsPerPeriod = min(draft.periodicity.executionsPerPeriod, draft.periodicity.intervalWeeks * 7)

        state = .editing(draft)
    }

    func save() async {

        switch state {

        case .saving, .saved:
            return

        case .editing, .failure:
            break
        }

        let draft = state.draft

        state = .saving(draft)

        do {

            let room = try await createRoom(
                name: draft.name,
                houseID: houseID,
                creatorUserID: creatorUserID,
                visibility: draft.visibility,
                periodicity: draft.periodicity,
                responsibleCount: draft.responsibleCount,
                appearance: draft.appearance,
                selectedParticipantIDs: draft.selectedParticipantIDs
            )

            state = .saved(room)

        } catch {

            state = .failure(
                draft,
                error.localizedDescription
            )
        }
    }
}
