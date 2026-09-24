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

    private let createRoom: CreateRoomUseCase

    private let houseID: House.ID
    private let creatorUserID: User.ID

    init(
        createRoom: CreateRoomUseCase,
        houseID: House.ID,
        creatorUserID: User.ID,
        draft: RoomDraft = RoomDraft()
    ) {

        self.createRoom = createRoom
        self.houseID = houseID
        self.creatorUserID = creatorUserID
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
                category: draft.category,
                visibility: draft.visibility
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
