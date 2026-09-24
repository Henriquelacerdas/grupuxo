//
//  RoomEditorState.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 18/09/26.
//

import Foundation

struct RoomDraft: Equatable {

    var name = ""
    var appearance = RoomAppearance()
    var selectedParticipantIDs: Set<User.ID> = []
    var periodicity = WeeklyPeriodicity()
    var responsibleCount = 1

    var visibility: RoomVisibility = .common
}

enum RoomEditorState: Equatable {

    case editing(RoomDraft)

    case saving(RoomDraft)

    case saved(Room)

    case failure(RoomDraft, String)

    var draft: RoomDraft {

        switch self {

        case let .editing(draft),
             let .saving(draft),
             let .failure(draft, _):

            return draft

        case let .saved(room):

            return RoomDraft(
                name: room.name,
                appearance: room.appearance ?? RoomAppearance(),
                periodicity: room.periodicity,
                responsibleCount: room.responsibleCount,
                visibility: room.visibility
            )
        }
    }
}
