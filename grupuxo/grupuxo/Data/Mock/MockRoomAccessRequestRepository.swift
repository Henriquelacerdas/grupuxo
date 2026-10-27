import Foundation
import GrupuxoDomain

struct MockRoomAccessRequestRepository: RoomAccessRequestRepository {

    let store: MockStore

    func pendingRoomIDs(
        in houseID: House.ID,
        requesting userID: User.ID
    ) async throws -> Set<Room.ID> {

        await store.read { state in

            let houseRoomIDs = Set(
                state.rooms
                    .filter { $0.houseID == houseID }
                    .map(\.id)
            )

            return Set(
                state.roomAccessRequests
                    .filter { $0.userID == userID && houseRoomIDs.contains($0.roomID) }
                    .map(\.roomID)
            )
        }
    }

    func request(
        roomID: Room.ID,
        requesting userID: User.ID,
        at date: Date
    ) async throws {

        try await store.update { state in

            guard
                let room = state.rooms.first(where: { $0.id == roomID }),
                state.houseMemberships.contains(where: {
                    $0.houseID == room.houseID && $0.userID == userID
                })
            else {
                throw DomainError.entityNotFound
            }

            let isMember = state.roomMemberships.contains {
                $0.roomID == roomID && $0.userID == userID && $0.isCurrent
            }

            guard room.visibility == .privateRoom, !isMember else {
                throw DomainError.roomAccessNotRequestable
            }

            guard !state.roomAccessRequests.contains(where: {
                $0.roomID == roomID && $0.userID == userID
            }) else {
                return
            }

            state.roomAccessRequests.append(
                RoomAccessRequest(
                    id: UUID(),
                    roomID: roomID,
                    userID: userID,
                    requestedAt: date
                )
            )
        }
    }

    func cancel(
        roomID: Room.ID,
        requesting userID: User.ID
    ) async throws {

        await store.update { state in
            state.roomAccessRequests.removeAll {
                $0.roomID == roomID && $0.userID == userID
            }
        }
    }
}
